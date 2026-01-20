import sqlite3

def migrate():
    try:
        conn = sqlite3.connect('bookkeeping.db')
        cursor = conn.cursor()
        
        # Check if column exists
        cursor.execute("PRAGMA table_info(transactions)")
        columns = [info[1] for info in cursor.fetchall()]
        
        if 'is_virtual' not in columns:
            print("Adding is_virtual column...")
            cursor.execute("ALTER TABLE transactions ADD COLUMN is_virtual BOOLEAN DEFAULT 0")
            conn.commit()
            print("Migration successful.")
        else:
            print("Column is_virtual already exists.")
            
        conn.close()
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    migrate()
