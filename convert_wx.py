import pandas as pd
import json
import datetime
import warnings

# 忽略 openpyxl 的样式警告
warnings.simplefilter("ignore")

# 辅助类：防止单独运行脚本时 JSON 序列化报错
class DateEncoder(json.JSONEncoder):
    def default(self, obj):
        if isinstance(obj, (datetime.date, datetime.datetime)):
            return obj.strftime('%Y-%m-%d')
        return super().default(obj)

def convert_wechat_excel_to_jsonl(file_path, output_path=None, extra_rules=None):
    """
    微信账单转换函数
    :param extra_rules: 从数据库传入的自定义规则字典 (Priority: High)
    """
    print(f"--- [Logic] 开始处理微信文件: {file_path} ---")
    
    # 1. 暴力读取，不指定表头
    try:
        df_raw = pd.read_excel(file_path, header=None)
    except Exception as e:
        print(f"❌ Excel 读取失败: {e}")
        return []

    # 2. 定位 "微信支付账单明细列表"
    header_index = -1
    for index, row in df_raw.head(50).iterrows():
        row_str = " ".join([str(x) for x in row.values if pd.notna(x)])
        if '微信支付账单明细列表' in row_str:
            header_index = index + 1
            break
            
    if header_index == -1:
        print("❌ 错误：未找到定位词 '微信支付账单明细列表'")
        return []

    # 3. 重构 DataFrame
    try:
        headers = df_raw.iloc[header_index].astype(str).str.strip()
        df = df_raw[header_index + 1:].copy()
        df.columns = headers
        df.reset_index(drop=True, inplace=True)
    except Exception as e:
        print(f"❌ 数据表重构失败: {e}")
        return []

    # 4. 清洗列名与查找关键列
    df.columns = df.columns.str.strip()
    
    amount_col = None
    for col in df.columns:
        if '金额' in str(col):
            amount_col = col
            break
            
    if not amount_col or '交易类型' not in df.columns:
        print("❌ 缺少必要列 (金额/交易类型)")
        return []

    # 5. 过滤商户消费
    for col in df.columns:
        if df[col].dtype == 'object':
            df[col] = df[col].astype(str).str.strip()
            
    df = df[df['交易类型'] == '商户消费'].copy()

    # ==========================================
    # 核心字典逻辑：默认字典在脚本内部维护
    # ==========================================
    default_rules = {
        '美团': 'Food', '饿了么': 'Food', '肯德基': 'Food', '麦当劳': 'Food',
        '星巴克': 'Food', '瑞幸': 'Food', '喜茶': 'Food', '茶百道': 'Food',
        '山姆': 'Groceries', '全家': 'Groceries', '超市': 'Groceries', '罗森': 'Groceries',
        '7-ELEVEn': 'Groceries', '便利': 'Groceries',
        '地铁': 'Transport', '滴滴': 'Transport', '打车': 'Transport', 
        '铁路': 'Transport', '公交': 'Transport',
        '电费': 'Utilities', '话费': 'Utilities', '水费': 'Utilities','Bilibili': 'Entertainment',
        '淘宝': 'Shopping', '京东': 'Shopping', '唯品会': 'Shopping', '拼多多': 'Shopping'
    }
    
    # 合并逻辑：数据库传来的 extra_rules 覆盖默认字典
    category_keywords = default_rules.copy()
    if extra_rules:
        category_keywords.update(extra_rules)

    def get_category(merchant, product):
        full_text = f"{merchant} {product}"
        for keyword, cat in category_keywords.items():
            if keyword in full_text:
                return cat
        return 'Uncategorized'

    # 6. 转换数据
    transactions = []
    
    for index, row in df.iterrows():
        try:
            # 金额
            raw_val = row[amount_col]
            if isinstance(raw_val, str):
                amount = float(raw_val.replace('¥', '').replace('￥', '').replace(',', '').strip())
            else:
                amount = float(raw_val)
            
            direction = str(row['收/支']).strip()
            final_amount = -amount if direction == '支出' else amount
            
            # 描述
            merchant = str(row.get('交易对方', '')).strip()
            raw_prod = row.get('商品', '')
            product = str(raw_prod).strip()
            if product.lower() in ['/', 'nan', '', 'na', 'null']:
                desc = merchant
            else:
                desc = f"{merchant} - {product}"

            # 日期 (返回 Python 对象)
            date_obj = pd.to_datetime(row['交易时间']).date()

            transactions.append({
                "date": date_obj,
                "amount": final_amount,
                "category": get_category(merchant, product),
                "description": desc,
                "type": 'expense' if final_amount < 0 else 'income',
                "is_amortized": False,
                "unit": "months",
                "skip_weekends": False
            })
            
        except Exception:
            continue

    if output_path:
        with open(output_path, 'w', encoding='utf-8') as f:
            for t in transactions:
                f.write(json.dumps(t, cls=DateEncoder, ensure_ascii=False) + '\n')

    return transactions