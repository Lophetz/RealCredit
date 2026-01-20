"""
Database migration script to add 'type' column for Income Tracking.
"""
from sqlalchemy import create_engine, text

DATABASE_URL = "sqlite:///./simple_log.db"
engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})

def migrate():
    with engine.connect() as conn:
        try:
            # Default to 'expense' for existing records
            conn.execute(text("ALTER TABLE expenses ADD COLUMN type VARCHAR DEFAULT 'expense'"))
            print("✓ Added 'type' column")
        except Exception as e:
            print(f"'type' column already exists or error: {e}")
        
        conn.commit()
        print("\n✅ Migration completed!")

if __name__ == "__main__":
    migrate()
