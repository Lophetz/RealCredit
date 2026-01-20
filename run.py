import uvicorn
import os
import sys

if __name__ == "__main__":
    # Ensure current directory is in path (crucial for bundled app)
    if getattr(sys, 'frozen', False):
        os.chdir(sys._MEIPASS)
        
    # Start the server
    # reload=False is important for frozen app
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=False, workers=1)
