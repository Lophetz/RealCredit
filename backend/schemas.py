from pydantic import BaseModel
from typing import List, Optional
from datetime import date, datetime

class JournalEntryBase(BaseModel):
    account_id: int
    debit: float = 0.0
    credit: float = 0.0

class TransactionCreate(BaseModel):
    date: datetime = datetime.now()
    description: str
    entries: List[JournalEntryBase]

class AccountCreate(BaseModel):
    name: str
    type: str # Asset, Liability, Equity, Income, Expense

class FixedAssetCreate(BaseModel):
    name: str
    cost: float
    salvage_value: float = 0.0
    useful_life_years: int
    purchase_date: date
    asset_account_id: int
    depreciation_expense_account_id: int

class DepreciationRequest(BaseModel):
    months: int = 12
