"""
Database migration script to add new amortization fields to existing database.
Run this once to update the database schema.
"""
from sqlalchemy import create_engine, text

DATABASE_URL = "sqlite:///./simple_log.db"
engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})

def migrate():
    with engine.connect() as conn:
        # Add new columns if they don't exist
        try:
            conn.execute(text("ALTER TABLE expenses ADD COLUMN original_amount FLOAT"))
            print("✓ Added original_amount column")
        except Exception as e:
            print(f"original_amount column already exists or error: {e}")
        
        try:
            conn.execute(text("ALTER TABLE expenses ADD COLUMN amortization_months INTEGER DEFAULT 1"))
            print("✓ Added amortization_months column")
        except Exception as e:
            print(f"amortization_months column already exists or error: {e}")
        
        try:
            conn.execute(text("ALTER TABLE expenses ADD COLUMN amortization_index INTEGER DEFAULT 0"))
            print("✓ Added amortization_index column")
        except Exception as e:
            print(f"amortization_index column already exists or error: {e}")
        
        conn.commit()
        print("\n✅ Migration completed!")

if __name__ == "__main__":
    migrate()
