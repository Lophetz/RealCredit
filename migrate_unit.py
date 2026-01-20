"""
Migration script to add unit and skip_weekends columns to existing expenses
"""
import sqlite3

# Connect to the database
conn = sqlite3.connect('simple_log.db')
cursor = conn.cursor()

# Add unit column if it doesn't exist
try:
    cursor.execute("ALTER TABLE expenses ADD COLUMN unit TEXT DEFAULT 'months'")
    print("Added 'unit' column")
except sqlite3.OperationalError as e:
    if "duplicate column name" in str(e).lower():
        print("'unit' column already exists")
    else:
        raise

# Add skip_weekends column if it doesn't exist
try:
    cursor.execute("ALTER TABLE expenses ADD COLUMN skip_weekends INTEGER DEFAULT 0")
    print("Added 'skip_weekends' column")
except sqlite3.OperationalError as e:
    if "duplicate column name" in str(e).lower():
        print("'skip_weekends' column already exists")
    else:
        raise

# Update existing records to have default values
cursor.execute("UPDATE expenses SET unit = 'months' WHERE unit IS NULL")
cursor.execute("UPDATE expenses SET skip_weekends = 0 WHERE skip_weekends IS NULL")

conn.commit()
conn.close()

print("Migration completed successfully!")
