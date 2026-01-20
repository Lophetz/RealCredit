from sqlalchemy import create_engine, Column, Integer, String, Float, Date, Boolean
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from datetime import date

import sys
import os

if getattr(sys, 'frozen', False):
    # Running in a bundle/exe
    # DB should be next to the executable, not in the temp _MEIPASS folder
    base_path = os.path.dirname(sys.executable)
    db_path = os.path.join(base_path, "simple_log.db")
    DATABASE_URL = f"sqlite:///{db_path}"
else:
    # Running in normal python environment
    DATABASE_URL = "sqlite:///./simple_log.db"

engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

class ExpenseItem(Base):
    __tablename__ = "expenses"

    id = Column(Integer, primary_key=True, index=True)
    date = Column(Date, index=True)
    amount = Column(Float)
    currency = Column(String, default="CNY")
    category = Column(String) # For styling e.g. "Food", "Transport"
    description = Column(String)
    type = Column(String, default="expense") # 'expense' or 'income'
    
    # Amortization Metadata
    is_amortized = Column(Boolean, default=False)
    group_id = Column(String, nullable=True) # To link split items together
    original_amount = Column(Float, nullable=True)  # Original total before amortization
    amortization_months = Column(Integer, default=1)  # Total months to amortize
    amortization_index = Column(Integer, default=0)  # Which month (0-indexed)
    unit = Column(String, default="months")  # 'months' or 'days'
    skip_weekends = Column(Boolean, default=False)  # Whether to skip weekends for daily amortization

    
    # Deprecated fields from old double-entry can be ignored or we start fresh.
    # We are starting fresh with simple_log.db

class Category(Base):
    __tablename__ = "categories"
    
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, index=True)
    icon = Column(String, default="📝")

class Budget(Base):
    __tablename__ = "budgets"
    
    id = Column(Integer, primary_key=True, index=True)
    month = Column(String, unique=True, index=True) # Format "YYYY-MM"

    amount = Column(Float, default=0.0)

class CategoryRule(Base):
    __tablename__ = "category_rules"
    
    id = Column(Integer, primary_key=True, index=True)
    keyword = Column(String, unique=True, index=True)
    category = Column(String)

Base.metadata.create_all(bind=engine)
