from fastapi import FastAPI, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List, Optional
from datetime import date, timedelta
from pydantic import BaseModel
import uuid
import models
from models import SessionLocal, ExpenseItem
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

app = FastAPI()

@app.on_event("startup")
def startup_event():
    db = SessionLocal()
    # Check if categories exist
    if db.query(models.Category).count() == 0:
        defaults = [
            ("Food", "🍔"), ("Transport", "🚗"), ("Shopping", "🛍️"), 
            ("Housing", "🏠"), ("Entertainment", "🎬"), ("Utilities", "💡"),
            ("Salary", "💰"), ("Business", "💼"), ("Investment", "📈"), 
            ("Other", "📦")
        ]
        for name, icon in defaults:
            db.add(models.Category(name=name, icon=icon))
        db.commit()
    db.close()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Dependency
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# Pydantic Models
class ExpenseCreate(BaseModel):
    date: date
    amount: float
    category: str
    description: str
    amortization_months: Optional[int] = 1 # Used as "duration"
    type: Optional[str] = "expense"
    unit: Optional[str] = "months" # 'months' or 'days'
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
    month: str # YYYY-MM
    amount: float

class BudgetOut(BaseModel):
    month: str
    amount: float
    
    class Config:
        from_attributes = True



@app.post("/expenses", response_model=List[ExpenseOut])
def create_expense(item: ExpenseCreate, db: Session = Depends(get_db)):
    created_items = []
    
    if item.amortization_months and item.amortization_months > 1:
        # Amortization / recurring Logic
        total_amount = item.amount
        duration = item.amortization_months # Duration in months or days
        
        # Calculate individual entry amount
        unit_amount = round(total_amount / duration, 2)
        group_id = str(uuid.uuid4())
        
        current_date = item.date
        count = 0
        
        while count < duration:
            # Check for weekend skipping if enabled and unit is days
            if item.unit == 'days' and item.skip_weekends:
                # 0-4 are Mon-Fri, 5-6 are Sat-Sun
                while current_date.weekday() >= 5:
                    current_date += timedelta(days=1)
            
            new_expense = models.ExpenseItem(
                date=current_date,
                amount=unit_amount,
                category=item.category,
                description=item.description,
                is_amortized=True,
                group_id=group_id,
                original_amount=total_amount,
                amortization_months=duration,
                amortization_index=count,
                type=item.type or 'expense',
                unit=item.unit or 'months',
                skip_weekends=item.skip_weekends or False
            )
            db.add(new_expense)
            created_items.append(new_expense)
            
            # Increment date
            if item.unit == 'days':
                current_date += timedelta(days=1)
            else:
                # Add one month
                # Month calculation logic for next iteration
                # We need to base it off start date to avoid drift, but simpler to just add roughly?
                # Let's stick to the robust logic from before:
                # Calculate next month based on initial start date + count + 1
                year = item.date.year + (item.date.month + count) // 12
                month = (item.date.month + count) % 12 + 1
                try:
                    next_month_date = date(year, month, item.date.day)
                except ValueError:
                    import calendar
                    last_day = calendar.monthrange(year, month)[1]
                    next_month_date = date(year, month, last_day)
                current_date = next_month_date
            
            count += 1


            
    else:
        # Single Entry
        new_expense = models.ExpenseItem(
            date=item.date,
            amount=item.amount,
            category=item.category,
            description=item.description,
            is_amortized=False,
            type=item.type or 'expense'
        )
        db.add(new_expense)
        created_items.append(new_expense)
    
    db.commit()
    for i in created_items:
        db.refresh(i)
        
    return created_items

@app.get("/expenses", response_model=List[ExpenseOut])
def get_expenses(start_date: Optional[date] = None, end_date: Optional[date] = None, db: Session = Depends(get_db)):
    query = db.query(models.ExpenseItem)
    if start_date:
        query = query.filter(models.ExpenseItem.date >= start_date)
    if end_date:
        query = query.filter(models.ExpenseItem.date <= end_date)
    return query.order_by(models.ExpenseItem.date).all()

@app.put("/expenses/{expense_id}", response_model=List[ExpenseOut])
def update_expense(expense_id: int, item: ExpenseCreate, db: Session = Depends(get_db)):
    existing = db.query(models.ExpenseItem).filter(models.ExpenseItem.id == expense_id).first()
    if not existing:
        raise HTTPException(status_code=404, detail="未找到记录")
    
    updated_items = []
    
    # If it was amortized and still is, check if period changed
    if existing.is_amortized and item.amortization_months and item.amortization_months > 1:
        # Delete all items in the group
        db.query(models.ExpenseItem).filter(models.ExpenseItem.group_id == existing.group_id).delete()
        
        # Create new amortized entries with updated values
        total_amount = item.amount
        duration = item.amortization_months
        per_period_amount = round(total_amount / duration, 2)
        group_id = existing.group_id or str(uuid.uuid4())
        unit = item.unit or 'months'
        skip_weekends = item.skip_weekends or False
        
        current_date = item.date
        count = 0
        
        while count < duration:
            # Check for weekend skipping if enabled and unit is days
            if unit == 'days' and skip_weekends:
                while current_date.weekday() >= 5:
                    current_date += timedelta(days=1)
            
            new_expense = models.ExpenseItem(
                date=current_date,
                amount=per_period_amount,
                category=item.category,
                description=item.description,
                is_amortized=True,
                group_id=group_id,
                original_amount=total_amount,
                amortization_months=duration,
                amortization_index=count,
                type=item.type or 'expense',
                unit=unit,
                skip_weekends=skip_weekends
            )
            db.add(new_expense)
            updated_items.append(new_expense)
            
            # Increment date
            if unit == 'days':
                current_date += timedelta(days=1)
            else:
                # Monthly increment
                year = item.date.year + (item.date.month + count) // 12
                month = (item.date.month + count) % 12 + 1
                try:
                    next_month_date = date(year, month, item.date.day)
                except ValueError:
                    import calendar
                    last_day = calendar.monthrange(year, month)[1]
                    next_month_date = date(year, month, last_day)
                current_date = next_month_date
            
            count += 1
    
    elif existing.is_amortized and (not item.amortization_months or item.amortization_months == 1):
        # Was amortized, now single - delete group, create single
        db.query(models.ExpenseItem).filter(models.ExpenseItem.group_id == existing.group_id).delete()
        
        new_expense = models.ExpenseItem(
            date=item.date,
            amount=item.amount,
            category=item.category,
            description=item.description,
            is_amortized=False,
            type=item.type or 'expense'
        )
        db.add(new_expense)
        updated_items.append(new_expense)
    
    elif not existing.is_amortized and item.amortization_months and item.amortization_months > 1:
        # Was single, now amortized - delete single, create group
        db.delete(existing)
        
        total_amount = item.amount
        duration = item.amortization_months
        per_period_amount = round(total_amount / duration, 2)
        group_id = str(uuid.uuid4())
        unit = item.unit or 'months'
        skip_weekends = item.skip_weekends or False
        
        current_date = item.date
        count = 0
        
        while count < duration:
            # Check for weekend skipping if enabled and unit is days
            if unit == 'days' and skip_weekends:
                while current_date.weekday() >= 5:
                    current_date += timedelta(days=1)
            
            new_expense = models.ExpenseItem(
                date=current_date,
                amount=per_period_amount,
                category=item.category,
                description=item.description,
                is_amortized=True,
                group_id=group_id,
                original_amount=total_amount,
                amortization_months=duration,
                amortization_index=count,
                type=item.type or 'expense',
                unit=unit,
                skip_weekends=skip_weekends
            )
            db.add(new_expense)
            updated_items.append(new_expense)
            
            # Increment date
            if unit == 'days':
                current_date += timedelta(days=1)
            else:
                # Monthly increment
                year = item.date.year + (item.date.month + count) // 12
                month = (item.date.month + count) % 12 + 1
                try:
                    next_month_date = date(year, month, item.date.day)
                except ValueError:
                    import calendar
                    last_day = calendar.monthrange(year, month)[1]
                    next_month_date = date(year, month, last_day)
                current_date = next_month_date
            
            count += 1
    
    else:
        # Simple update - not amortized
        existing.date = item.date
        existing.amount = item.amount
        existing.category = item.category
        existing.description = item.description
        existing.type = item.type or 'expense'
        updated_items.append(existing)
    
    db.commit()
    for i in updated_items:
        db.refresh(i)
    
    return updated_items


@app.delete("/expenses/{expense_id}")
def delete_expense(expense_id: int, delete_series: bool = False, db: Session = Depends(get_db)):
    item = db.query(models.ExpenseItem).filter(models.ExpenseItem.id == expense_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="未找到记录")
    
    if delete_series and item.group_id:
        # Delete all items in the group
        db.query(models.ExpenseItem).filter(models.ExpenseItem.group_id == item.group_id).delete()
    else:
        # Delete single item
        db.delete(item)
        
    db.commit()

    return {"message": "成功"}

@app.delete("/expenses")
def delete_all_expenses(db: Session = Depends(get_db)):
    """Delete all expenses - for debugging purposes"""
    db.query(models.ExpenseItem).delete()
    db.commit()
    return {"message": "所有支出已删除"}

@app.post("/expenses/bulk_replace", response_model=List[ExpenseOut])
def bulk_replace_expenses(items: List[ExpenseOut], db: Session = Depends(get_db)):
    """
    DANGER: Replaces ALL expenses with the provided list.
    Used for the Developer Mode JSONL editor.
    """
    # 1. Delete all existing
    db.query(models.ExpenseItem).delete()
    
    # 2. Insert new ones
    new_objects = []
    for item in items:
        # We use strict mapping to ensure we keep IDs and all fields from the dump
        expense_data = item.dict()
        
        # SQLAlchemy model instantiation
        new_expense = models.ExpenseItem(
            id=expense_data['id'], # Preserve ID
            date=expense_data['date'],
            amount=expense_data['amount'],
            category=expense_data['category'],
            description=expense_data['description'],
            type=expense_data['type'],
            is_amortized=expense_data['is_amortized'],
            group_id=expense_data['group_id'],
            original_amount=expense_data['original_amount'],
            amortization_months=expense_data['amortization_months'],
            amortization_index=expense_data['amortization_index'],
            unit=expense_data.get('unit', 'months'),
            skip_weekends=expense_data.get('skip_weekends', False)
        )
        new_objects.append(new_expense)
    
    db.add_all(new_objects)
    db.commit()
    
    return new_objects



@app.get("/categories", response_model=List[CategoryOut])
def get_categories(db: Session = Depends(get_db)):
    return db.query(models.Category).all()

@app.post("/categories", response_model=CategoryOut)
def create_category(category: CategoryCreate, db: Session = Depends(get_db)):
    # Check if exists
    existing = db.query(models.Category).filter(models.Category.name == category.name).first()
    if existing:
        raise HTTPException(status_code=400, detail="分类已存在")
        
    db_cat = models.Category(name=category.name, icon=category.icon)
    db.add(db_cat)
    db.commit()
    db.refresh(db_cat)
    return db_cat

@app.delete("/categories/{cat_id}")
def delete_category(cat_id: int, db: Session = Depends(get_db)):
    db_cat = db.query(models.Category).filter(models.Category.id == cat_id).first()
    if not db_cat:
        raise HTTPException(status_code=404, detail="未找到分类")
    
    # Optional: Check if used? For now, just delete.
    # If we delete a category that expenses use, they might show just the name or fallback.
    # The expenses store the category name string, not ID, so deleting the category definition 
    # won't break existing expenses' display, just their icon lookup.
    
    db.delete(db_cat)
    db.commit()
    return {"message": "分类已删除"}

    db.delete(db_cat)
    db.commit()
    return {"message": "Category deleted"}

@app.get("/budgets/{month}", response_model=BudgetOut)
def get_budget(month: str, db: Session = Depends(get_db)):
    # Month format YYYY-MM
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
    else:
        new_budget = models.Budget(month=item.month, amount=item.amount)
        db.add(new_budget)
        db.commit()
        db.refresh(new_budget)
        return new_budget

# --- Rule & Import Routes ---

class RuleCreate(BaseModel):
    keyword: str
    category: str

class RuleOut(BaseModel):
    id: int
    keyword: str
    category: str
    class Config:
        from_attributes = True

@app.get("/rules", response_model=List[RuleOut])
def get_rules(db: Session = Depends(get_db)):
    rules = db.query(models.CategoryRule).all()
    # If empty, Seed defaults
    if not rules:
        defaults = {
            '美团': 'Food', '饿了么': 'Food', '肯德基': 'Food', '麦当劳': 'Food',
            '星巴克': 'Food', '瑞幸': 'Food', 
            '山姆': 'Groceries', '全家': 'Groceries', '超市': 'Groceries',
            '地铁': 'Transport', '滴滴': 'Transport'
        }
        for k, v in defaults.items():
            db.add(models.CategoryRule(keyword=k, category=v))
        db.commit()
        rules = db.query(models.CategoryRule).all()
    return rules

@app.post("/rules", response_model=RuleOut)
def create_rule(rule: RuleCreate, db: Session = Depends(get_db)):
    existing = db.query(models.CategoryRule).filter(models.CategoryRule.keyword == rule.keyword).first()
    if existing:
        raise HTTPException(status_code=400, detail="该关键词规则已存在")
    new_rule = models.CategoryRule(keyword=rule.keyword, category=rule.category)
    db.add(new_rule)
    db.commit()
    db.refresh(new_rule)
    return new_rule

@app.delete("/rules/{rule_id}")
def delete_rule(rule_id: int, db: Session = Depends(get_db)):
    db.query(models.CategoryRule).filter(models.CategoryRule.id == rule_id).delete()
    db.commit()
    return {"message": "已删除"}

import pandas as pd
import io
from fastapi import FastAPI, Depends, HTTPException, UploadFile, File
from sqlalchemy.orm import Session
from typing import List
import shutil
import tempfile
import os
from convert_wx import convert_wechat_excel_to_jsonl
from convert_zfb import convert_alipay_excel_to_jsonl

@app.post("/import/wechat")
async def import_wechat(file: UploadFile = File(...), db: Session = Depends(get_db)):
    """
    微信账单导入接口
    1. 获取数据库内的自定义规则
    2. 上传并保存临时文件
    3. 调用 convert_wx 脚本处理 (内置默认字典 + 数据库自定义规则)
    4. 写入数据库
    """
    tmp_path = None
    try:
        # 1. 从数据库获取自定义规则 (Rule 表)
        # 这一步是为了让你的“自定义规则”功能生效，而不是把字典硬编码在 main 里
        db_rules = db.query(models.CategoryRule).all()
        # 转换为简单字典: {'关键词': '分类'}
        custom_rules = {r.keyword: r.category for r in db_rules}
        
        # 2. 保存上传的文件到临时目录
        suffix = os.path.splitext(file.filename)[1]
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            shutil.copyfileobj(file.file, tmp)
            tmp_path = tmp.name
            
        # 3. 调用外部转换脚本
        # 此时只需传入 custom_rules，默认字典已经在 convert_wx.py 里了
        transactions = convert_wechat_excel_to_jsonl(tmp_path, None, custom_rules)
        
        # 4. 批量入库
        if not transactions:
            return {"message": "未找到有效的可导入交易。"}

        new_expenses = []
        for item in transactions:
            new_expenses.append(models.ExpenseItem(
                date=item['date'], # 已经是 date 对象了
                amount=item['amount'],
                category=item['category'],
                description=item['description'],
                type=item['type'],
                # 补充数据库默认字段
                is_amortized=False,
                unit='months',
                skip_weekends=False,
                original_amount=None,
                group_id=None
            ))
        
        # 使用 bulk_save_objects 提高大量数据插入的效率
        db.bulk_save_objects(new_expenses)
        db.commit()
        
        return {"message": f"成功从微信导入 {len(transactions)} 条交易"}
            
    except Exception as e:
        print(f"Import Error: {e}")
        raise HTTPException(status_code=500, detail=f"导入失败: {str(e)}")
        
    finally:
        # 清理垃圾文件
        if tmp_path and os.path.exists(tmp_path):
            try:
                os.remove(tmp_path)
            except:
                pass

@app.post("/import/alipay")
async def import_alipay(file: UploadFile = File(...), db: Session = Depends(get_db)):
    try:
        # Create temp file
        suffix = os.path.splitext(file.filename)[1]
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            shutil.copyfileobj(file.file, tmp)
            tmp_path = tmp.name
            
        try:
            # Call external script
            transactions = convert_alipay_excel_to_jsonl(tmp_path, None)
            
            # Bulk Insert
            for item in transactions:
                new_expense = models.ExpenseItem(
                    date=item['date'],
                    amount=item['amount'],
                    category=item['category'],
                    description=item['description'],
                    type=item['type'],
                    is_amortized=False,
                    unit='months',
                    skip_weekends=False
                )
                db.add(new_expense)
            db.commit()
            return {"message": f"成功从支付宝导入 {len(transactions)} 条交易"}
            
        finally:
            if os.path.exists(tmp_path):
                os.remove(tmp_path)

    except Exception as e:
        print(f"Alipay Import Error: {e}")
        raise HTTPException(status_code=500, detail=f"导入失败: {str(e)}")


app.mount("/", StaticFiles(directory=".", html=True), name="static")
