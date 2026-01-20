# RealCredit - 个人财务管理系统

RealCredit 是一个由 [Yuqiu] 设计开发的现代化个人记账与财务管理应用。它采用轻量级技术栈（FastAPI + Vanilla JS），无需复杂配置即可在本地运行，提供流畅的“类 Notion”看板体验。

## ✨ 核心特性

- **📅 多视图看板**
  - **Daily (每日)**: 横向无限滚动的日期列，直观查看每一天的收支。
  - **Monthly (每月)**: 宏观视角的月度报表，自动汇总分类支出与收入。
  - **Calendar (日历)**: 经典日历视图，快速概览全月每日盈亏。

- **💸 智能费用管理**
  - **摊销/分期 (Amortization)**: 支持将大额支出（如房租、保险、会员费）按月或按天自动分摊到未来，真实反映每日财务压力。
  - **收入与支出**: 完整支持双向记账，绿色记录收入，红色记录支出。
  - **周末跳过**: 每日摊销模式下可选“跳过周末”，适用于工作日餐费等场景。

- **📥 智能导入**
  - **微信/支付宝账单**: 支持直接拖拽上传 Excel/CSV 账单文件。
  - **自定义规则**: 设置关键词规则（如 "KFC" -> "Food"），导入时自动分类。

## 🛠️ 技术栈

![Python](https://img.shields.io/badge/Python-3.9+-yellow?style=flat-square&logo=python)
![FastAPI](https://img.shields.io/badge/FastAPI-0.100+-009688?style=flat-square&logo=fastapi)
![SQLite](https://img.shields.io/badge/SQLite-Database-003B57?style=flat-square&logo=sqlite)
![HTML5](https://img.shields.io/badge/Frontend-Vanilla_JS-E34F26?style=flat-square&logo=html5)

- **Backend**: Python FastAPI, SQLAlchemy, Pydantic V2
- **Database**: SQLite (无需安装额外数据库软件)
- **Frontend**: 原生 HTML5, CSS3 (CSS Variables for Theming), JavaScript (ES6+)

## 🚀 快速开始

### 1. 环境准备
确保已安装 Python 3.8 或更高版本。

```bash
# 克隆或下载本项目
git clone https://github.com/your-repo/RealCredit.git
cd RealCredit

# 安装依赖
pip install -r requirements.txt
```

### 2. 启动服务
使用 `uvicorn` 启动后端服务：

```bash
uvicorn main:app --reload
```
或者运行：
```bash
python run.py
```

### 3. 开始使用
打开浏览器访问：[http://127.0.0.1:8000](http://127.0.0.1:8000)

## 📖 操作指南

### 记一笔
1. 点击任意日期列底部的 **`+ Add Item`**。
2. 填写 **金额** 和 **描述**。
3. 选择 **分类**（或新建分类）。
4. (可选) 设置 **摊销**：
   - 例如支付了 1200 元年费，设置 Duration 为 12 Months。
   - 系统会自动在接下来 12 个月的对应日期生成 100 元的记录。

### 导入账单
1. 点击顶部导航栏的 **`Import`** 按钮。
2. 选择来源（微信/支付宝）。
3. 拖入导出的 Excel/CSV 文件。
4. (可选) 在右侧设置关键词规则以自动分类。
5. 点击 **`Upload & Import`**。

### 开发者模式 (数据备份/恢复)
1. 点击顶部 **`Dev`** 按钮。
2. 你将看到所有数据的 JSONL 格式。
3. 你可以复制出来备份，或者粘贴新的 JSON 数据来覆盖数据库。

## � 项目结构

```
RealCredit/
├── main.py              # FastAPI 后端核心逻辑
├── models.py            # SQLAlchemy 数据库模型
├── run.py               # 启动脚本
├── script.js            # 前端交互逻辑 (API调用, UI渲染)
├── style.css            # 样式表 (包含 Dark/Light 主题定义)
├── index.html           # 主页入口
├── simple_log.db        # 默认数据库文件 (自动生成)
├── convert_wx.py        # 微信账单解析逻辑
└── convert_zfb.py       # 支付宝账单解析逻辑
```

## ⚠️ 注意事项
- 数据保存在本地 `simple_log.db` 文件中，请定期备份该文件。
- 这是一个本地单用户应用，不建议部署在公网环境而不加验证。

---
Release v1.0.0 - 2026-01-20
