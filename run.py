import uvicorn
import os
import sys
# ✅ 新增：直接导入 app 对象
from main import app 

if __name__ == "__main__":
    if getattr(sys, 'frozen', False):
        os.chdir(sys._MEIPASS)
        
    # ✅ 正确写法：直接传 app 对象，而不是字符串
    uvicorn.run(app, host="127.0.0.1", port=8000) 
    # 注意：传对象时，reload=False 是默认的，workers 参数可能不支持（通常不需要）