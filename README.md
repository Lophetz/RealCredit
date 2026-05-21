# RealCredit

RealCredit 是一个本地运行的个人记账应用，适合管理日常收支、分期摊销、预算和账单导入。  
当前版本基于 `FastAPI + SQLite + 原生 HTML/CSS/JS`，默认把数据保存在项目目录下的 `simple_log.db`。

## 当前功能

- 日视图、月视图、日历视图
- 收入 / 支出记录
- 按月或按天的分期摊销
- 月预算与预算进度条
- 微信 / 支付宝账单导入
- 导入预览、重复项识别、规则命中说明
- 分类管理与关键词归类规则
- 搜索与筛选
- 周期洞察卡片
- 分期看板
- JSONL 开发者编辑模式
- 完整备份与恢复

## 运行方式

### 环境要求

- Python 3.10+
- Windows 优先

### 本地启动

```bash
pip install -r requirements.txt
python run.py
```

启动后访问：

- [http://127.0.0.1:8000](http://127.0.0.1:8000)

## 数据文件

- 主数据库：`simple_log.db`
- 打包入口：`run.py`
- 打包配置：`RealCredit.spec`

建议定期备份数据库，或者直接在应用里使用“备份”功能导出 JSON。

## 导入说明

支持以下来源：

- 微信账单
- 支付宝账单

导入流程分两步：

1. 先预览
2. 再确认导入

预览阶段会展示：

- 解析到多少条记录
- 哪些记录疑似重复
- 哪些记录会新增
- 关键词规则如何命中分类

正式导入时会自动跳过重复项。当前去重规则基于：

- 日期
- 金额
- 描述
- 类型

## 备份与恢复

应用支持完整备份导出与恢复，包含：

- 流水记录
- 分类
- 预算
- 关键词规则

恢复备份会覆盖当前数据，恢复前建议先导出一次现有备份。

## Git 与身份说明

`git push` 用哪个 GitHub 账号，和提交里显示的作者名字，不是同一个概念：

- 推送账号：由你本机保存的 GitHub 凭据决定
- 提交作者名：由本机 Git 的 `user.name` 决定
- 提交邮箱：由本机 Git 的 `user.email` 决定

所以：

- 用 [Lophetz](https://github.com/Lophetz) 这个 GitHub 账号完全没问题
- 你之前暴露真实姓名，是因为本机 Git 全局配置里 `user.name` 就是真名

如果你想后续提交显示成 `Lophetz`，至少要把仓库或全局 Git 身份改掉。  
如果你还不想暴露真实邮箱，建议同时改成 GitHub 的 `noreply` 邮箱。

## 当前目录结构

当前生效的主线文件：

- `main.py`：FastAPI 接口
- `models.py`：SQLite / SQLAlchemy 模型
- `run.py`：本地启动入口
- `index.html`：页面结构
- `script.js`：前端逻辑
- `style.css`：样式
- `convert_wx.py`：微信账单转换
- `convert_zfb.py`：支付宝账单转换

旧版 `backend/` 和 `static/` 原型已经移除。
