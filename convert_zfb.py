import pandas as pd
import json
import datetime

# 辅助类：用于处理 JSON 写入时的日期转换
class DateEncoder(json.JSONEncoder):
    def default(self, obj):
        if isinstance(obj, (datetime.date, datetime.datetime)):
            return obj.strftime('%Y-%m-%d')
        return super().default(obj)

def convert_alipay_excel_to_jsonl(file_path, output_path=None):
    print(f"--- 处理支付宝文件: {file_path} ---")
    
    # 1. 确定编码
    encodings = ['gbk', 'gb18030', 'utf-8']
    lines = []
    used_encoding = None

    for enc in encodings:
        try:
            with open(file_path, 'r', encoding=enc) as f:
                lines = f.readlines()
            used_encoding = enc
            break
        except UnicodeDecodeError:
            continue
            
    if not lines:
        return []

    # 2. 定位 "电子客户回单"
    header_line_index = -1
    for i, line in enumerate(lines):
        if "电子客户回单" in line:
            header_line_index = i + 1 
            break
    
    if header_line_index == -1:
        return []

    # 3. 读取数据
    try:
        df = pd.read_csv(file_path, encoding=used_encoding, skiprows=header_line_index)
    except Exception:
        return []

    # 清洗列名和内容
    df.columns = df.columns.str.strip()
    if '交易时间' not in df.columns or '收/支' not in df.columns:
        return []

    for col in df.columns:
        if df[col].dtype == 'object':
            df[col] = df[col].astype(str).str.strip()

    df = df[(df['收/支'] != '不计收支') & (df['交易时间'].notna())].copy()

    # 4. 映射分类
    category_map = {
        '餐饮美食': 'Food', '日用百货': 'Groceries', '交通出行': 'Transport',
        '文化休闲': 'Entertainment', '运动健康': 'Sports', '医疗健康': 'Medical',
        '生活服务': 'Services', '教育培训': 'Education', '美容美发': 'Beauty',
        '服饰装扮': 'Shopping', '数码电器': 'Shopping', '家居家装': 'Shopping',
        '爱车养车': 'Transport', '充值缴费': 'Utilities', '转账红包': 'Transfer',
        '其他': 'Other'
    }

    transactions = []

    for index, row in df.iterrows():
        try:
            amount = float(row['金额'])
            direction = row['收/支']
            final_amount = -amount if direction == '支出' else amount
            
            counterparty = row.get('交易对方', '')
            product_desc = row.get('商品说明', '')
            
            if product_desc in counterparty or product_desc == 'nan' or not product_desc:
                full_desc = counterparty
            else:
                full_desc = f"{counterparty} - {product_desc}"

            cat = row.get('交易分类', '')
            final_cat = category_map.get(cat, 'Other')

            # --- 关键修改：返回 datetime.date 对象，而不是字符串 ---
            raw_date = row['交易时间']
            date_obj = pd.to_datetime(raw_date).date() 

            transactions.append({
                "date": date_obj, # 这里现在是对象了
                "amount": final_amount,
                "category": final_cat,
                "description": full_desc,
                "type": 'expense' if final_amount < 0 else 'income',
                "is_amortized": False,
                "unit": "months",
                "skip_weekends": False
            })
            
        except Exception:
            continue

    # 返回结果
    if output_path:
        with open(output_path, 'w', encoding='utf-8') as f:
            for t in transactions:
                # 使用自定义 Encoder 处理日期对象
                f.write(json.dumps(t, cls=DateEncoder, ensure_ascii=False) + '\n')
    
    return transactions