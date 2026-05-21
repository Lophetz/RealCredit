from __future__ import annotations

import calendar
import os
import shutil
import tempfile
import uuid
from datetime import date, datetime, timedelta
from typing import Any, Dict, Iterable, List, Optional

from fastapi import Depends, FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from sqlalchemy.orm import Session

import models
from convert_wx import convert_wechat_excel_to_jsonl
from convert_zfb import convert_alipay_excel_to_jsonl
from models import SessionLocal

app = FastAPI(title="RealCredit")


DEFAULT_CATEGORIES = [
    ("Food", "🍜"),
    ("Transport", "🚇"),
    ("Shopping", "🛍️"),
    ("Housing", "🏠"),
    ("Entertainment", "🎮"),
    ("Utilities", "💡"),
    ("Salary", "💼"),
    ("Business", "📈"),
    ("Investment", "📊"),
    ("Other", "📦"),
]

DEFAULT_RULES = {
    "KFC": "Food",
    "MCDONALD": "Food",
    "麦当劳": "Food",
    "肯德基": "Food",
    "星巴克": "Food",
    "瑞幸": "Food",
    "盒马": "Groceries",
    "山姆": "Groceries",
    "叮咚": "Groceries",
    "滴滴": "Transport",
    "地铁": "Transport",
    "公交": "Transport",
}


app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@app.on_event("startup")
def startup_event():
    db = SessionLocal()
    try:
        seed_categories(db)
    finally:
        db.close()


class ExpenseCreate(BaseModel):
    date: date
    amount: float
    category: str
    description: str
    amortization_months: Optional[int] = 1
    type: Optional[str] = "expense"
    unit: Optional[str] = "months"
    skip_weekends: Optional[bool] = False


class ExpenseOut(BaseModel):
    id: int
    date: date
    amount: float
    category: str
    description: str
    is_amortized: bool
    type: str
    original_amount: Optional[float] = None
    amortization_months: int = 1
    amortization_index: int = 0
    group_id: Optional[str] = None
    unit: Optional[str] = "months"
    skip_weekends: Optional[bool] = False

    class Config:
        from_attributes = True


class CategoryCreate(BaseModel):
    name: str
    icon: str


class CategoryOut(BaseModel):
    id: int
    name: str
    icon: str

    class Config:
        from_attributes = True


class BudgetSet(BaseModel):
    month: str
    amount: float


class BudgetOut(BaseModel):
    month: str
    amount: float

    class Config:
        from_attributes = True


class RuleCreate(BaseModel):
    keyword: str
    category: str


class RuleOut(BaseModel):
    id: int
    keyword: str
    category: str

    class Config:
        from_attributes = True


class ImportPreviewItem(BaseModel):
    date: date
    amount: float
    category: str
    description: str
    type: str
    duplicate: bool
    explanation: str


class ImportPreviewResponse(BaseModel):
    total_parsed: int
    duplicate_candidates: int
    new_candidates: int
    preview_items: List[ImportPreviewItem]


class ImportApplyResponse(BaseModel):
    message: str
    total_parsed: int
    imported_count: int
    duplicate_count: int


class BackupCategory(BaseModel):
    id: Optional[int] = None
    name: str
    icon: str


class BackupBudget(BaseModel):
    id: Optional[int] = None
    month: str
    amount: float


class BackupRule(BaseModel):
    id: Optional[int] = None
    keyword: str
    category: str


class BackupPayload(BaseModel):
    exported_at: Optional[str] = None
    expenses: List[ExpenseOut]
    categories: List[BackupCategory]
    budgets: List[BackupBudget]
    rules: List[BackupRule]


def seed_categories(db: Session) -> None:
    if db.query(models.Category).count() > 0:
        return

    for name, icon in DEFAULT_CATEGORIES:
        db.add(models.Category(name=name, icon=icon))
    db.commit()


def ensure_rules(db: Session) -> List[models.CategoryRule]:
    rules = db.query(models.CategoryRule).order_by(models.CategoryRule.id.asc()).all()
    if rules:
        return rules

    for keyword, category in DEFAULT_RULES.items():
        db.add(models.CategoryRule(keyword=keyword, category=category))
    db.commit()
    return db.query(models.CategoryRule).order_by(models.CategoryRule.id.asc()).all()


def normalize_text(value: Optional[str]) -> str:
    return " ".join((value or "").strip().lower().split())


def expense_fingerprint(expense_date: date, amount: float, description: str, entry_type: str) -> str:
    normalized_amount = f"{round(float(amount), 2):.2f}"
    return "|".join(
        [
            expense_date.isoformat(),
            normalized_amount,
            normalize_text(description),
            normalize_text(entry_type or "expense"),
        ]
    )


def existing_fingerprints(db: Session) -> set[str]:
    fingerprints: set[str] = set()
    query = db.query(models.ExpenseItem.date, models.ExpenseItem.amount, models.ExpenseItem.description, models.ExpenseItem.type)
    for expense_date, amount, description, entry_type in query.all():
        fingerprints.add(expense_fingerprint(expense_date, amount, description, entry_type or "expense"))
    return fingerprints


def month_shift(start_date: date, offset: int) -> date:
    month_index = start_date.month - 1 + offset
    year = start_date.year + month_index // 12
    month = month_index % 12 + 1
    last_day = calendar.monthrange(year, month)[1]
    day = min(start_date.day, last_day)
    return date(year, month, day)


def build_expense_items(item: ExpenseCreate, group_id: Optional[str] = None) -> List[models.ExpenseItem]:
    duration = max(1, item.amortization_months or 1)
    is_series = duration > 1
    unit = item.unit or "months"
    entry_type = item.type or "expense"
    skip_weekends = bool(item.skip_weekends)

    if not is_series:
        return [
            models.ExpenseItem(
                date=item.date,
                amount=item.amount,
                category=item.category,
                description=item.description,
                is_amortized=False,
                type=entry_type,
                unit=unit,
                skip_weekends=skip_weekends,
            )
        ]

    total_amount = item.amount
    per_period_amount = round(total_amount / duration, 2)
    series_group_id = group_id or str(uuid.uuid4())
    current_date = item.date
    created_items: List[models.ExpenseItem] = []

    for index in range(duration):
        if unit == "days" and skip_weekends:
            while current_date.weekday() >= 5:
                current_date += timedelta(days=1)

        created_items.append(
            models.ExpenseItem(
                date=current_date,
                amount=per_period_amount,
                category=item.category,
                description=item.description,
                is_amortized=True,
                group_id=series_group_id,
                original_amount=total_amount,
                amortization_months=duration,
                amortization_index=index,
                type=entry_type,
                unit=unit,
                skip_weekends=skip_weekends,
            )
        )

        if unit == "days":
            current_date += timedelta(days=1)
        else:
            current_date = month_shift(item.date, index + 1)

    return created_items


def transaction_explanation(source: str, transaction: Dict[str, Any], rules_map: Dict[str, str]) -> str:
    description = transaction.get("description", "")
    if source == "wechat":
        description_lower = description.lower()
        for keyword, category in rules_map.items():
            if keyword.lower() in description_lower:
                return f"命中规则“{keyword}”，自动归类到 {category}"
        return "未命中关键词规则，沿用转换结果"

    if transaction.get("category") and transaction["category"] != "Other":
        return f"根据支付宝账单分类映射为 {transaction['category']}"
    return "未命中映射规则，归类为 Other"


def parse_transactions_for_source(source: str, file_path: str, db: Session) -> List[Dict[str, Any]]:
    if source == "wechat":
        rules_map = {rule.keyword: rule.category for rule in ensure_rules(db)}
        return convert_wechat_excel_to_jsonl(file_path, None, rules_map)
    if source == "alipay":
        return convert_alipay_excel_to_jsonl(file_path, None)
    raise HTTPException(status_code=400, detail="Unsupported import source")


def build_import_preview(source: str, transactions: List[Dict[str, Any]], db: Session) -> ImportPreviewResponse:
    rules_map = {rule.keyword: rule.category for rule in ensure_rules(db)} if source == "wechat" else {}
    existing = existing_fingerprints(db)
    preview_items: List[ImportPreviewItem] = []
    duplicate_count = 0

    for transaction in transactions:
        fingerprint = expense_fingerprint(
            transaction["date"],
            transaction["amount"],
            transaction["description"],
            transaction["type"],
        )
        is_duplicate = fingerprint in existing
        if is_duplicate:
            duplicate_count += 1

        if len(preview_items) < 20:
            preview_items.append(
                ImportPreviewItem(
                    date=transaction["date"],
                    amount=transaction["amount"],
                    category=transaction["category"],
                    description=transaction["description"],
                    type=transaction["type"],
                    duplicate=is_duplicate,
                    explanation=transaction_explanation(source, transaction, rules_map),
                )
            )

    return ImportPreviewResponse(
        total_parsed=len(transactions),
        duplicate_candidates=duplicate_count,
        new_candidates=max(0, len(transactions) - duplicate_count),
        preview_items=preview_items,
    )


def apply_import_transactions(transactions: List[Dict[str, Any]], db: Session) -> ImportApplyResponse:
    existing = existing_fingerprints(db)
    imported_count = 0
    duplicate_count = 0

    for transaction in transactions:
        fingerprint = expense_fingerprint(
            transaction["date"],
            transaction["amount"],
            transaction["description"],
            transaction["type"],
        )
        if fingerprint in existing:
            duplicate_count += 1
            continue

        expense = models.ExpenseItem(
            date=transaction["date"],
            amount=transaction["amount"],
            category=transaction["category"],
            description=transaction["description"],
            type=transaction["type"],
            is_amortized=False,
            unit="months",
            skip_weekends=False,
            original_amount=None,
            group_id=None,
        )
        db.add(expense)
        existing.add(fingerprint)
        imported_count += 1

    db.commit()

    return ImportApplyResponse(
        message=f"导入完成：新增 {imported_count} 条，跳过重复 {duplicate_count} 条",
        total_parsed=len(transactions),
        imported_count=imported_count,
        duplicate_count=duplicate_count,
    )


def save_upload_tempfile(upload: UploadFile) -> str:
    suffix = os.path.splitext(upload.filename or "")[1]
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as temp_file:
        shutil.copyfileobj(upload.file, temp_file)
        return temp_file.name


@app.post("/expenses", response_model=List[ExpenseOut])
def create_expense(item: ExpenseCreate, db: Session = Depends(get_db)):
    created_items = build_expense_items(item)
    for created_item in created_items:
        db.add(created_item)

    db.commit()
    for created_item in created_items:
        db.refresh(created_item)
    return created_items


@app.get("/expenses", response_model=List[ExpenseOut])
def get_expenses(
    start_date: Optional[date] = None,
    end_date: Optional[date] = None,
    db: Session = Depends(get_db),
):
    query = db.query(models.ExpenseItem)
    if start_date:
        query = query.filter(models.ExpenseItem.date >= start_date)
    if end_date:
        query = query.filter(models.ExpenseItem.date <= end_date)
    return query.order_by(models.ExpenseItem.date.asc(), models.ExpenseItem.id.asc()).all()


@app.put("/expenses/{expense_id}", response_model=List[ExpenseOut])
def update_expense(expense_id: int, item: ExpenseCreate, db: Session = Depends(get_db)):
    existing = db.query(models.ExpenseItem).filter(models.ExpenseItem.id == expense_id).first()
    if not existing:
        raise HTTPException(status_code=404, detail="Expense not found")

    updated_items: List[models.ExpenseItem] = []
    requested_series = max(1, item.amortization_months or 1) > 1

    if existing.is_amortized:
        db.query(models.ExpenseItem).filter(models.ExpenseItem.group_id == existing.group_id).delete()
        new_group_id = existing.group_id if requested_series else None
        updated_items = build_expense_items(item, group_id=new_group_id)
        for created_item in updated_items:
            db.add(created_item)
    elif requested_series:
        db.delete(existing)
        updated_items = build_expense_items(item)
        for created_item in updated_items:
            db.add(created_item)
    else:
        existing.date = item.date
        existing.amount = item.amount
        existing.category = item.category
        existing.description = item.description
        existing.type = item.type or "expense"
        existing.unit = item.unit or "months"
        existing.skip_weekends = bool(item.skip_weekends)
        existing.is_amortized = False
        existing.group_id = None
        existing.original_amount = None
        existing.amortization_months = 1
        existing.amortization_index = 0
        updated_items = [existing]

    db.commit()
    for updated_item in updated_items:
        db.refresh(updated_item)
    return updated_items


@app.delete("/expenses/{expense_id}")
def delete_expense(expense_id: int, delete_series: bool = False, db: Session = Depends(get_db)):
    item = db.query(models.ExpenseItem).filter(models.ExpenseItem.id == expense_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Expense not found")

    if delete_series and item.group_id:
        db.query(models.ExpenseItem).filter(models.ExpenseItem.group_id == item.group_id).delete()
    else:
        db.delete(item)

    db.commit()
    return {"message": "Deleted"}


@app.delete("/expenses")
def delete_all_expenses(db: Session = Depends(get_db)):
    db.query(models.ExpenseItem).delete()
    db.commit()
    return {"message": "All expenses deleted"}


@app.post("/expenses/bulk_replace", response_model=List[ExpenseOut])
def bulk_replace_expenses(items: List[ExpenseOut], db: Session = Depends(get_db)):
    db.query(models.ExpenseItem).delete()

    new_objects = []
    for item in items:
        expense_data = item.model_dump()
        new_objects.append(
            models.ExpenseItem(
                id=expense_data["id"],
                date=expense_data["date"],
                amount=expense_data["amount"],
                category=expense_data["category"],
                description=expense_data["description"],
                type=expense_data["type"],
                is_amortized=expense_data["is_amortized"],
                group_id=expense_data["group_id"],
                original_amount=expense_data["original_amount"],
                amortization_months=expense_data["amortization_months"],
                amortization_index=expense_data["amortization_index"],
                unit=expense_data.get("unit", "months"),
                skip_weekends=expense_data.get("skip_weekends", False),
            )
        )

    db.add_all(new_objects)
    db.commit()
    for new_object in new_objects:
        db.refresh(new_object)
    return new_objects


@app.get("/categories", response_model=List[CategoryOut])
def get_categories(db: Session = Depends(get_db)):
    seed_categories(db)
    return db.query(models.Category).order_by(models.Category.name.asc()).all()


@app.post("/categories", response_model=CategoryOut)
def create_category(category: CategoryCreate, db: Session = Depends(get_db)):
    existing = db.query(models.Category).filter(models.Category.name == category.name).first()
    if existing:
        raise HTTPException(status_code=400, detail="Category already exists")

    db_category = models.Category(name=category.name, icon=category.icon)
    db.add(db_category)
    db.commit()
    db.refresh(db_category)
    return db_category


@app.delete("/categories/{category_id}")
def delete_category(category_id: int, db: Session = Depends(get_db)):
    db_category = db.query(models.Category).filter(models.Category.id == category_id).first()
    if not db_category:
        raise HTTPException(status_code=404, detail="Category not found")

    db.delete(db_category)
    db.commit()
    return {"message": "Category deleted"}


@app.get("/budgets/{month}", response_model=BudgetOut)
def get_budget(month: str, db: Session = Depends(get_db)):
    budget = db.query(models.Budget).filter(models.Budget.month == month).first()
    if not budget:
        return {"month": month, "amount": 0.0}
    return budget


@app.post("/budgets", response_model=BudgetOut)
def set_budget(item: BudgetSet, db: Session = Depends(get_db)):
    existing = db.query(models.Budget).filter(models.Budget.month == item.month).first()
    if existing:
        existing.amount = item.amount
        db.commit()
        db.refresh(existing)
        return existing

    new_budget = models.Budget(month=item.month, amount=item.amount)
    db.add(new_budget)
    db.commit()
    db.refresh(new_budget)
    return new_budget


@app.get("/rules", response_model=List[RuleOut])
def get_rules(db: Session = Depends(get_db)):
    return ensure_rules(db)


@app.post("/rules", response_model=RuleOut)
def create_rule(rule: RuleCreate, db: Session = Depends(get_db)):
    existing = db.query(models.CategoryRule).filter(models.CategoryRule.keyword == rule.keyword).first()
    if existing:
        raise HTTPException(status_code=400, detail="Rule already exists")

    new_rule = models.CategoryRule(keyword=rule.keyword, category=rule.category)
    db.add(new_rule)
    db.commit()
    db.refresh(new_rule)
    return new_rule


@app.delete("/rules/{rule_id}")
def delete_rule(rule_id: int, db: Session = Depends(get_db)):
    db.query(models.CategoryRule).filter(models.CategoryRule.id == rule_id).delete()
    db.commit()
    return {"message": "Rule deleted"}


@app.post("/import/{source}/preview", response_model=ImportPreviewResponse)
async def preview_import(source: str, file: UploadFile = File(...), db: Session = Depends(get_db)):
    temp_path = save_upload_tempfile(file)
    try:
        transactions = parse_transactions_for_source(source, temp_path, db)
        return build_import_preview(source, transactions, db)
    except HTTPException:
        raise
    except Exception as exc:
        print(f"Import preview error: {exc}")
        raise HTTPException(status_code=500, detail=f"Import preview failed: {exc}")
    finally:
        if os.path.exists(temp_path):
            os.remove(temp_path)


@app.post("/import/{source}", response_model=ImportApplyResponse)
async def import_transactions(source: str, file: UploadFile = File(...), db: Session = Depends(get_db)):
    temp_path = save_upload_tempfile(file)
    try:
        transactions = parse_transactions_for_source(source, temp_path, db)
        if not transactions:
            return ImportApplyResponse(
                message="No valid transactions found in the file",
                total_parsed=0,
                imported_count=0,
                duplicate_count=0,
            )
        return apply_import_transactions(transactions, db)
    except HTTPException:
        raise
    except Exception as exc:
        print(f"Import error: {exc}")
        raise HTTPException(status_code=500, detail=f"Import failed: {exc}")
    finally:
        if os.path.exists(temp_path):
            os.remove(temp_path)


@app.post("/import/wechat/preview", response_model=ImportPreviewResponse, include_in_schema=False)
async def preview_import_wechat(file: UploadFile = File(...), db: Session = Depends(get_db)):
    return await preview_import("wechat", file, db)


@app.post("/import/alipay/preview", response_model=ImportPreviewResponse, include_in_schema=False)
async def preview_import_alipay(file: UploadFile = File(...), db: Session = Depends(get_db)):
    return await preview_import("alipay", file, db)


@app.post("/import/wechat", response_model=ImportApplyResponse, include_in_schema=False)
async def import_wechat(file: UploadFile = File(...), db: Session = Depends(get_db)):
    return await import_transactions("wechat", file, db)


@app.post("/import/alipay", response_model=ImportApplyResponse, include_in_schema=False)
async def import_alipay(file: UploadFile = File(...), db: Session = Depends(get_db)):
    return await import_transactions("alipay", file, db)


@app.get("/backup/export")
def export_backup(db: Session = Depends(get_db)):
    payload = {
        "exported_at": datetime.utcnow().isoformat() + "Z",
        "expenses": [ExpenseOut.model_validate(item, from_attributes=True).model_dump(mode="json") for item in get_expenses(db=db)],
        "categories": [CategoryOut.model_validate(item, from_attributes=True).model_dump(mode="json") for item in get_categories(db=db)],
        "budgets": [
            {"id": budget.id, "month": budget.month, "amount": budget.amount}
            for budget in db.query(models.Budget).order_by(models.Budget.month.asc()).all()
        ],
        "rules": [
            {"id": rule.id, "keyword": rule.keyword, "category": rule.category}
            for rule in get_rules(db=db)
        ],
    }
    return payload


@app.post("/backup/import")
def import_backup(payload: BackupPayload, db: Session = Depends(get_db)):
    db.query(models.ExpenseItem).delete()
    db.query(models.CategoryRule).delete()
    db.query(models.Budget).delete()
    db.query(models.Category).delete()

    for category in payload.categories:
        db.add(models.Category(id=category.id, name=category.name, icon=category.icon))

    for budget in payload.budgets:
        db.add(models.Budget(id=budget.id, month=budget.month, amount=budget.amount))

    for rule in payload.rules:
        db.add(models.CategoryRule(id=rule.id, keyword=rule.keyword, category=rule.category))

    for item in payload.expenses:
        expense_data = item.model_dump()
        db.add(
            models.ExpenseItem(
                id=expense_data["id"],
                date=expense_data["date"],
                amount=expense_data["amount"],
                category=expense_data["category"],
                description=expense_data["description"],
                type=expense_data["type"],
                is_amortized=expense_data["is_amortized"],
                group_id=expense_data["group_id"],
                original_amount=expense_data["original_amount"],
                amortization_months=expense_data["amortization_months"],
                amortization_index=expense_data["amortization_index"],
                unit=expense_data.get("unit", "months"),
                skip_weekends=expense_data.get("skip_weekends", False),
            )
        )

    db.commit()
    return {
        "message": "Backup restored",
        "expenses": len(payload.expenses),
        "categories": len(payload.categories),
        "budgets": len(payload.budgets),
        "rules": len(payload.rules),
    }


app.mount("/", StaticFiles(directory=".", html=True), name="static")
