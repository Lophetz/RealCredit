from sqlalchemy import Column, Integer, String, Float, ForeignKey, DateTime, Date, Boolean
from sqlalchemy.orm import relationship
import datetime
from .database import Base

class Account(Base):
    __tablename__ = "accounts"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, index=True)
    type = Column(String)  # Asset, Liability, Equity, Income, Expense
    balance = Column(Float, default=0.0)

    entries = relationship("JournalEntry", back_populates="account")


class Transaction(Base):
    __tablename__ = "transactions"

    id = Column(Integer, primary_key=True, index=True)
    date = Column(DateTime, default=datetime.datetime.utcnow)
    description = Column(String)
    is_virtual = Column(Boolean, default=False)
    
    entries = relationship("JournalEntry", back_populates="transaction")


class JournalEntry(Base):
    __tablename__ = "journal_entries"

    id = Column(Integer, primary_key=True, index=True)
    transaction_id = Column(Integer, ForeignKey("transactions.id"))
    account_id = Column(Integer, ForeignKey("accounts.id"))
    debit = Column(Float, default=0.0)
    credit = Column(Float, default=0.0)

    transaction = relationship("Transaction", back_populates="entries")
    account = relationship("Account", back_populates="entries")


class FixedAsset(Base):
    __tablename__ = "fixed_assets"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String)
    cost = Column(Float)
    salvage_value = Column(Float, default=0.0)
    useful_life_years = Column(Integer)
    purchase_date = Column(Date)
    accumulated_depreciation = Column(Float, default=0.0)
    
    # Link to the asset account where this is recorded
    asset_account_id = Column(Integer, ForeignKey("accounts.id"))
    asset_account = relationship("Account", foreign_keys=[asset_account_id])
    
    # Link to the expense account for depreciation
    depreciation_expense_account_id = Column(Integer, ForeignKey("accounts.id"))
    depreciation_expense_account = relationship("Account", foreign_keys=[depreciation_expense_account_id])
