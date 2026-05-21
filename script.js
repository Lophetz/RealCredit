const API_URL = "http://localhost:8000";

let currentDate = new Date();
let currentView = "daily";
let expenses = [];
let filteredExpenses = [];
let monthBudget = 0;
let categoriesList = [];
let categoryIcons = {};
let rulesList = [];
let importPreviewCache = null;

const filters = {
    search: "",
    type: "all",
    category: "all",
    amortization: "all",
};

const emojiList = [
    "🍜", "🚇", "🛍️", "🏠", "🎮", "💡", "💼", "📈", "📊", "📦",
    "🐾", "✈️", "🏥", "🎓", "☕", "🍔", "🧴", "🎁", "🚗", "🏋️",
    "🎬", "📚", "🧸", "💄", "🧰", "🧾", "🎵", "🍺", "🪴", "🧳",
];


function parseDateValue(value) {
    if (value instanceof Date) {
        return new Date(value.getFullYear(), value.getMonth(), value.getDate());
    }
    if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
        const [year, month, day] = value.split("-").map(Number);
        return new Date(year, month - 1, day);
    }
    return new Date(value);
}


function formatDate(dateObj) {
    const year = dateObj.getFullYear();
    const month = String(dateObj.getMonth() + 1).padStart(2, "0");
    const day = String(dateObj.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}


function formatCurrency(amount, digits = 2) {
    return `¥${Number(amount || 0).toFixed(digits)}`;
}


function normalizeText(value) {
    return (value || "").toString().trim().toLowerCase();
}


function setStatus(elementId, text, tone = "neutral") {
    const element = document.getElementById(elementId);
    if (!element) return;

    element.textContent = text;
    element.classList.remove("tone-success", "tone-warning", "tone-danger");
    if (tone === "success") element.classList.add("tone-success");
    if (tone === "warning") element.classList.add("tone-warning");
    if (tone === "danger") element.classList.add("tone-danger");
}


function getTodayString() {
    return formatDate(new Date());
}


function getVisibleExpenses() {
    return filteredExpenses;
}


function getExpensesForDate(dateStr) {
    return getVisibleExpenses().filter((expense) => expense.date === dateStr);
}


function getExpensesForMonth(year, month) {
    return getVisibleExpenses().filter((expense) => {
        const expenseDate = parseDateValue(expense.date);
        return expenseDate.getFullYear() === year && expenseDate.getMonth() + 1 === month;
    });
}


function getRangeExpenses(startDate, endDate) {
    const startStr = formatDate(startDate);
    const endStr = formatDate(endDate);
    return getVisibleExpenses().filter((expense) => expense.date >= startStr && expense.date <= endStr);
}


function aggregateByCategory(items) {
    const categoryTotals = {};
    let expenseTotal = 0;
    let incomeTotal = 0;

    items.forEach((item) => {
        const category = item.category || "Other";
        if (!categoryTotals[category]) {
            categoryTotals[category] = { expense: 0, income: 0 };
        }

        const amount = Math.abs(Number(item.amount || 0));
        if ((item.type || "expense") === "income") {
            categoryTotals[category].income += amount;
            incomeTotal += amount;
        } else {
            categoryTotals[category].expense += amount;
            expenseTotal += amount;
        }
    });

    return {
        categoryTotals,
        expenseTotal,
        incomeTotal,
        netTotal: incomeTotal - expenseTotal,
    };
}


function getRangeContext() {
    if (currentView === "daily") {
        const start = new Date(currentDate);
        start.setDate(start.getDate() - 3);
        const end = new Date(start);
        end.setDate(end.getDate() + 6);
        return {
            label: "7 天窗口",
            start,
            end,
        };
    }

    const start = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
    const end = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0);
    return {
        label: currentView === "monthly" ? "当月洞察" : "日历月洞察",
        start,
        end,
    };
}


async function fetchBudget(dateObj) {
    const monthStr = formatDate(new Date(dateObj.getFullYear(), dateObj.getMonth(), 1)).slice(0, 7);
    try {
        const response = await fetch(`${API_URL}/budgets/${monthStr}`);
        if (!response.ok) return;
        const data = await response.json();
        monthBudget = Number(data.amount || 0);

        const budgetWidget = document.getElementById("budget-widget");
        const budgetInput = document.getElementById("month-budget-input");
        if (currentView === "daily") {
            budgetWidget.style.display = "flex";
            budgetInput.value = monthBudget > 0 ? monthBudget : "";
        } else {
            budgetWidget.style.display = "none";
        }
    } catch (error) {
        console.error("fetch budget failed", error);
    }
}


async function updateBudget() {
    const amount = parseFloat(document.getElementById("month-budget-input").value) || 0;
    const monthStr = formatDate(new Date(currentDate.getFullYear(), currentDate.getMonth(), 1)).slice(0, 7);

    try {
        await fetch(`${API_URL}/budgets`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ month: monthStr, amount }),
        });
        monthBudget = amount;
        await renderCurrentView();
    } catch (error) {
        console.error("update budget failed", error);
    }
}


async function fetchExpenses() {
    const response = await fetch(`${API_URL}/expenses`);
    if (!response.ok) {
        throw new Error(`加载记录失败: ${response.statusText}`);
    }
    expenses = await response.json();
}


async function fetchCategories() {
    const response = await fetch(`${API_URL}/categories`);
    if (!response.ok) return;

    categoriesList = await response.json();
    categoryIcons = {};
    categoriesList.forEach((category) => {
        categoryIcons[category.name] = category.icon;
    });

    populateCategorySelect();
    populateCategoryFilter();
    renderRuleSelect();
}


async function fetchRules() {
    const response = await fetch(`${API_URL}/rules`);
    if (!response.ok) return;
    rulesList = await response.json();
    renderRules(rulesList);
}


function populateCategorySelect() {
    const select = document.getElementById("category");
    if (!select) return;

    select.innerHTML = "";
    categoriesList.forEach((category) => {
        const option = document.createElement("option");
        option.value = category.name;
        option.textContent = `${category.icon} ${category.name}`;
        select.appendChild(option);
    });

    const newOption = document.createElement("option");
    newOption.value = "__NEW__";
    newOption.textContent = "➕ 新建分类...";
    select.appendChild(newOption);

    select.onchange = (event) => {
        const value = event.target.value;
        if (value === "__NEW__") {
            openAddCategoryModal();
            if (categoriesList[0]) {
                select.value = categoriesList[0].name;
            }
        }
    };
}


function populateCategoryFilter() {
    const select = document.getElementById("category-filter");
    if (!select) return;

    const currentValue = select.value || "all";
    select.innerHTML = '<option value="all">全部分类</option>';

    categoriesList.forEach((category) => {
        const option = document.createElement("option");
        option.value = category.name;
        option.textContent = `${category.icon} ${category.name}`;
        select.appendChild(option);
    });

    select.value = categoriesList.some((category) => category.name === currentValue) ? currentValue : "all";
}


function renderRuleSelect() {
    const select = document.getElementById("rule-category");
    if (!select) return;

    const currentValue = select.value;
    select.innerHTML = "";
    categoriesList.forEach((category) => {
        const option = document.createElement("option");
        option.value = category.name;
        option.textContent = `${category.icon} ${category.name}`;
        select.appendChild(option);
    });

    if (currentValue && categoriesList.some((category) => category.name === currentValue)) {
        select.value = currentValue;
    }
}


function renderRules(rules) {
    const container = document.getElementById("rules-list");
    container.innerHTML = "";

    rules.forEach((rule) => {
        const item = document.createElement("div");
        item.className = "rule-item";
        item.innerHTML = `
            <div>
                <span class="rule-keyword">${rule.keyword}</span>
                <span class="rule-cat-tag">${rule.category}</span>
            </div>
            <button class="rule-delete" onclick="deleteRule(${rule.id})">✕</button>
        `;
        container.appendChild(item);
    });
}


function applyFilters(reRender = true) {
    filteredExpenses = expenses.filter((expense) => {
        const searchMatched = !filters.search || [
            expense.description,
            expense.category,
            expense.date,
            expense.type,
        ].some((field) => normalizeText(field).includes(filters.search));

        const typeMatched = filters.type === "all" || (expense.type || "expense") === filters.type;
        const categoryMatched = filters.category === "all" || expense.category === filters.category;
        const amortizationMatched =
            filters.amortization === "all" ||
            (filters.amortization === "amortized" && expense.is_amortized) ||
            (filters.amortization === "single" && !expense.is_amortized);

        return searchMatched && typeMatched && categoryMatched && amortizationMatched;
    });

    const meta = document.getElementById("filter-meta");
    if (meta) {
        const total = expenses.length;
        const visible = filteredExpenses.length;
        meta.textContent = visible === total ? `显示全部 ${total} 条记录` : `筛选后显示 ${visible} / ${total} 条记录`;
    }

    if (reRender) {
        renderCurrentView();
    }
}


function updateTotalBudgetProgress(year, month) {
    const container = document.getElementById("total-budget-container");
    if (!container) return;

    if (monthBudget <= 0) {
        container.style.display = "none";
        return;
    }

    container.style.display = "flex";
    const monthExpenses = getExpensesForMonth(year, month);
    const { expenseTotal } = aggregateByCategory(monthExpenses);
    const percent = Math.min((expenseTotal / monthBudget) * 100, 100);
    const overBudget = expenseTotal > monthBudget;
    const color = overBudget ? "#EF4444" : "#10B981";

    const fill = document.getElementById("total-budget-fill");
    const text = document.getElementById("total-budget-text");

    fill.style.width = `${percent}%`;
    fill.style.backgroundColor = color;
    text.textContent = `${formatCurrency(expenseTotal, 0)} / ${formatCurrency(monthBudget, 0)} (${percent.toFixed(0)}%)`;
    text.style.color = color;
}


function renderBoard(centerDate) {
    const board = document.getElementById("board");
    board.innerHTML = "";

    const start = new Date(centerDate);
    start.setDate(start.getDate() - 3);

    for (let index = 0; index < 7; index += 1) {
        const dateObj = new Date(start);
        dateObj.setDate(start.getDate() + index);
        const dateStr = formatDate(dateObj);
        const dayItems = getExpensesForDate(dateStr);

        let budgetStatusHtml = "";
        if (monthBudget > 0) {
            const daysInMonth = new Date(dateObj.getFullYear(), dateObj.getMonth() + 1, 0).getDate();
            const dailyLimit = monthBudget / daysInMonth;
            const expenseTotal = dayItems
                .filter((item) => (item.type || "expense") !== "income")
                .reduce((sum, item) => sum + Math.abs(Number(item.amount || 0)), 0);

            const overLimit = expenseTotal > dailyLimit;
            const percent = dailyLimit > 0 ? Math.min((expenseTotal / dailyLimit) * 100, 100) : 0;
            const color = overLimit ? "#EF4444" : "#10B981";

            budgetStatusHtml = `
                <div class="daily-budget-status">
                    <div class="budget-bar">
                        <div class="budget-fill" style="width:${percent}%; background:${color};"></div>
                    </div>
                    <div class="budget-text" style="color:${color};">
                        ${formatCurrency(expenseTotal, 0)} / ${formatCurrency(dailyLimit, 0)}
                    </div>
                </div>
            `;
        }

        if (index === 0) {
            updateTotalBudgetProgress(dateObj.getFullYear(), dateObj.getMonth() + 1);
        }

        const column = document.createElement("div");
        column.className = "column";
        if (dateStr === getTodayString()) {
            column.classList.add("current-day-col");
        }

        const prettyDate = dateObj.toLocaleDateString("zh-CN", { month: "short", day: "numeric" });
        const weekday = dateObj.toLocaleDateString("zh-CN", { weekday: "short" });

        const itemsHtml = dayItems.map((item) => renderExpenseCard(item)).join("");
        column.innerHTML = `
            <div class="column-header">
                <div class="date-text">${prettyDate}</div>
                <div class="day-text">${weekday}</div>
                ${budgetStatusHtml}
            </div>
            <div class="column-content">
                ${itemsHtml || '<div class="category-item empty-column-tip">暂无记录</div>'}
                <div class="add-placeholder" onclick="openModal('${dateStr}')">+ 新增记录</div>
            </div>
        `;

        board.appendChild(column);
    }
}


function renderExpenseCard(item) {
    const entryType = item.type || "expense";
    const isIncome = entryType === "income";
    const amountClass = isIncome ? "income-amount" : "expense-amount";
    const prefix = isIncome ? "+" : "-";
    const amount = Math.abs(Number(item.amount || 0));
    const categoryIcon = categoryIcons[item.category] || "📦";

    let amountHtml = `<span class="card-amount ${amountClass}">${prefix}${formatCurrency(amount)}</span>`;
    if (item.is_amortized && item.original_amount) {
        const totalAmount = Math.abs(Number(item.original_amount || 0));
        const unitLabel = item.unit === "days" ? "天" : "月";
        amountHtml = `
            <div class="amount-display">
                <span class="amortized-amount ${amountClass}">${prefix}${formatCurrency(amount)}</span>
                <span class="original-amount">总额 ${formatCurrency(totalAmount)} / ${item.amortization_months}${unitLabel}</span>
                <span class="amortization-indicator">第 ${item.amortization_index + 1} / ${item.amortization_months} 期</span>
            </div>
        `;
    }

    return `
        <div class="expense-card ${isIncome ? "income-card" : ""}">
            <div class="card-top">
                <span class="card-desc">${item.description}</span>
                ${amountHtml}
            </div>
            <div class="card-footer">
                <div class="card-tags">
                    <span class="tag">${categoryIcon} ${item.category}</span>
                    ${item.is_amortized ? '<span class="tag amortized">分期</span>' : ""}
                    ${isIncome ? '<span class="tag income-tag">收入</span>' : ""}
                </div>
                <div class="card-actions-compact">
                    <button class="btn-icon" title="编辑" onclick="event.stopPropagation(); editExpense(${item.id})">✎</button>
                    <button class="btn-icon delete" title="删除" onclick="event.stopPropagation(); deleteExpenseWrapper(${item.id}, ${item.is_amortized}, '${item.group_id || ""}')">🗑</button>
                </div>
            </div>
        </div>
    `;
}


function renderMonthlyBoard(centerDate) {
    const board = document.getElementById("board");
    board.innerHTML = "";

    const centerYear = centerDate.getFullYear();
    const centerMonth = centerDate.getMonth() + 1;
    let startYear = centerYear;
    let startMonth = centerMonth - 5;
    if (startMonth <= 0) {
        startYear -= 1;
        startMonth += 12;
    }

    for (let index = 0; index < 12; index += 1) {
        let year = startYear;
        let month = startMonth + index;
        if (month > 12) {
            year += 1;
            month -= 12;
        }

        const monthExpenses = getExpensesForMonth(year, month);
        const { categoryTotals, expenseTotal, incomeTotal, netTotal } = aggregateByCategory(monthExpenses);
        const monthName = new Date(year, month - 1, 1).toLocaleDateString("zh-CN", { month: "long" });
        const today = new Date();

        const column = document.createElement("div");
        column.className = "month-column";
        if (year === today.getFullYear() && month === today.getMonth() + 1) {
            column.classList.add("current-day-col");
        }

        const categoryEntries = Object.entries(categoryTotals).sort((left, right) => {
            const leftTotal = left[1].expense + left[1].income;
            const rightTotal = right[1].expense + right[1].income;
            return rightTotal - leftTotal;
        });

        const categoryHtml = categoryEntries.length > 0
            ? categoryEntries.map(([category, totals]) => `
                <div class="category-item">
                    <span class="category-name">${categoryIcons[category] || "📦"} ${category}</span>
                    <div class="category-amounts">
                        ${totals.income > 0 ? `<span class="income-amount">+${formatCurrency(totals.income)}</span>` : ""}
                        ${totals.expense > 0 ? `<span class="expense-amount">-${formatCurrency(totals.expense)}</span>` : ""}
                    </div>
                </div>
            `).join("")
            : '<div class="category-item empty-column-tip">暂无记录</div>';

        column.innerHTML = `
            <div class="column-header">
                <div class="date-text">${monthName}</div>
                <div class="day-text">${year}</div>
            </div>
            <div class="month-summary">
                <div class="month-breakdown">
                    ${incomeTotal > 0 ? `<div class="income-total">+${formatCurrency(incomeTotal)}</div>` : ""}
                    ${expenseTotal > 0 ? `<div class="expense-total">-${formatCurrency(expenseTotal)}</div>` : ""}
                </div>
                <div class="month-total ${netTotal >= 0 ? "positive" : "negative"}">${formatCurrency(netTotal)}</div>
                <div class="month-label">净结余</div>
            </div>
            <div class="category-breakdown">${categoryHtml}</div>
        `;

        board.appendChild(column);
    }
}


function renderCalendarView(centerDate) {
    const board = document.getElementById("board");
    board.innerHTML = "";

    const year = centerDate.getFullYear();
    const month = centerDate.getMonth();
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    const calendarContainer = document.createElement("div");
    calendarContainer.className = "calendar-view";
    calendarContainer.innerHTML = `
        <div class="calendar-header">
            <h2>${new Date(year, month, 1).toLocaleDateString("zh-CN", { year: "numeric", month: "long" })}</h2>
        </div>
        <div class="calendar-weekdays">
            <div class="weekday-header">日</div>
            <div class="weekday-header">一</div>
            <div class="weekday-header">二</div>
            <div class="weekday-header">三</div>
            <div class="weekday-header">四</div>
            <div class="weekday-header">五</div>
            <div class="weekday-header">六</div>
        </div>
        <div class="calendar-grid" id="calendar-grid"></div>
    `;

    const grid = calendarContainer.querySelector("#calendar-grid");
    for (let index = 0; index < firstDay; index += 1) {
        const empty = document.createElement("div");
        empty.className = "calendar-day empty";
        grid.appendChild(empty);
    }

    for (let day = 1; day <= daysInMonth; day += 1) {
        const dateObj = new Date(year, month, day);
        const dateStr = formatDate(dateObj);
        const dayExpenses = getExpensesForDate(dateStr);
        const { expenseTotal, incomeTotal, netTotal } = aggregateByCategory(dayExpenses);

        const cell = document.createElement("div");
        cell.className = "calendar-day";
        if (dateStr === getTodayString()) {
            cell.classList.add("today");
        }

        cell.innerHTML = `
            <div class="day-number">${day}</div>
            ${dayExpenses.length > 0 ? `
                <div class="day-summary">
                    ${incomeTotal > 0 ? `<div class="income-total">+${formatCurrency(incomeTotal)}</div>` : ""}
                    ${expenseTotal > 0 ? `<div class="expense-total">-${formatCurrency(expenseTotal)}</div>` : ""}
                    <div class="net-total ${netTotal >= 0 ? "positive" : "negative"}">${formatCurrency(netTotal)}</div>
                </div>
            ` : '<div class="day-empty">-</div>'}
        `;

        cell.onclick = () => openModal(dateStr);
        grid.appendChild(cell);
    }

    board.appendChild(calendarContainer);
}


function renderInsights() {
    const container = document.getElementById("insight-strip");
    const range = getRangeContext();
    const rangeExpenses = getRangeExpenses(range.start, range.end);
    const { categoryTotals, expenseTotal, incomeTotal, netTotal } = aggregateByCategory(rangeExpenses);
    const days = Math.max(1, Math.round((range.end - range.start) / (24 * 60 * 60 * 1000)) + 1);
    const averageExpense = expenseTotal / days;

    const topCategoryEntry = Object.entries(categoryTotals)
        .sort((left, right) => right[1].expense - left[1].expense)[0];
    const topCategoryText = topCategoryEntry
        ? `${topCategoryEntry[0]} · ${formatCurrency(topCategoryEntry[1].expense)}`
        : "暂无数据";

    const biggestExpense = rangeExpenses
        .filter((item) => (item.type || "expense") !== "income")
        .sort((left, right) => Math.abs(right.amount) - Math.abs(left.amount))[0];

    let budgetDeltaText = "未设置预算";
    if (monthBudget > 0) {
        const monthExpenseTotal = aggregateByCategory(getExpensesForMonth(currentDate.getFullYear(), currentDate.getMonth() + 1)).expenseTotal;
        const delta = monthBudget - monthExpenseTotal;
        budgetDeltaText = delta >= 0
            ? `结余 ${formatCurrency(delta, 0)}`
            : `超支 ${formatCurrency(Math.abs(delta), 0)}`;
    }

    const cards = [
        { label: range.label, value: `${range.start.toLocaleDateString("zh-CN")} - ${range.end.toLocaleDateString("zh-CN")}` },
        { label: "净流入", value: formatCurrency(netTotal) },
        { label: "支出 / 收入", value: `${formatCurrency(expenseTotal)} / ${formatCurrency(incomeTotal)}` },
        { label: "日均支出", value: formatCurrency(averageExpense) },
        { label: "支出最高分类", value: topCategoryText },
        { label: "预算状态", value: budgetDeltaText },
        {
            label: "最大单笔支出",
            value: biggestExpense ? `${biggestExpense.description} · ${formatCurrency(Math.abs(biggestExpense.amount))}` : "暂无数据",
        },
    ];

    container.innerHTML = cards.map((card) => `
        <div class="insight-card">
            <div class="insight-label">${card.label}</div>
            <div class="insight-value">${card.value}</div>
        </div>
    `).join("");
}


function renderInstallmentDashboard() {
    const container = document.getElementById("installment-rail");
    const groups = {};
    const referenceDate = new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate());

    expenses
        .filter((item) => item.is_amortized && item.group_id)
        .forEach((item) => {
            if (!groups[item.group_id]) {
                groups[item.group_id] = [];
            }
            groups[item.group_id].push(item);
        });

    const cards = Object.values(groups)
        .map((items) => items.sort((left, right) => left.amortization_index - right.amortization_index))
        .map((items) => {
            const first = items[0];
            const totalPeriods = first.amortization_months || items.length;
            const originalAmount = Math.abs(Number(first.original_amount || items.reduce((sum, item) => sum + item.amount, 0)));
            const completedPeriods = items.filter((item) => parseDateValue(item.date) <= referenceDate).length;
            const remainingPeriods = Math.max(totalPeriods - completedPeriods, 0);
            const nextItem = items.find((item) => parseDateValue(item.date) > referenceDate);
            return {
                description: first.description,
                category: first.category,
                totalPeriods,
                originalAmount,
                completedPeriods,
                remainingPeriods,
                nextDate: nextItem ? nextItem.date : null,
                unit: first.unit === "days" ? "天" : "月",
            };
        })
        .filter((item) => item.remainingPeriods > 0)
        .sort((left, right) => left.remainingPeriods - right.remainingPeriods)
        .slice(0, 8);

    if (cards.length === 0) {
        container.innerHTML = '<div class="empty-state">当前没有进行中的分期记录</div>';
        return;
    }

    container.innerHTML = cards.map((card) => `
        <div class="installment-card">
            <div class="installment-title">${card.description}</div>
            <div class="installment-meta">${categoryIcons[card.category] || "📦"} ${card.category}</div>
            <div class="installment-progress">
                <div class="installment-progress-fill" style="width:${(card.completedPeriods / card.totalPeriods) * 100}%;"></div>
            </div>
            <div class="installment-stats">
                <span>总额 ${formatCurrency(card.originalAmount)}</span>
                <span>${card.completedPeriods}/${card.totalPeriods} ${card.unit}</span>
            </div>
            <div class="installment-stats">
                <span>剩余 ${card.remainingPeriods} ${card.unit}</span>
                <span>${card.nextDate ? `下次 ${card.nextDate}` : "已到最后一期"}</span>
            </div>
        </div>
    `).join("");
}


async function renderCurrentView() {
    if (currentView === "daily") {
        await fetchBudget(currentDate);
        renderBoard(currentDate);
    } else if (currentView === "monthly") {
        document.getElementById("budget-widget").style.display = "none";
        renderMonthlyBoard(currentDate);
    } else {
        document.getElementById("budget-widget").style.display = "none";
        renderCalendarView(currentDate);
    }

    renderInsights();
    renderInstallmentDashboard();
}


async function refreshAll() {
    await Promise.all([fetchCategories(), fetchRules(), fetchExpenses()]);
    applyFilters(false);
    await renderCurrentView();
}


async function createExpense(payload) {
    const expenseId = document.getElementById("expense-id").value;
    const method = expenseId ? "PUT" : "POST";
    const endpoint = expenseId ? `${API_URL}/expenses/${expenseId}` : `${API_URL}/expenses`;
    const response = await fetch(endpoint, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
    });

    if (!response.ok) {
        throw new Error(expenseId ? "更新失败" : "创建失败");
    }
}


async function editExpense(id) {
    const expense = expenses.find((item) => item.id === id);
    if (!expense) return;

    document.getElementById("modal-title").textContent = "编辑记录";
    document.getElementById("expense-id").value = id;
    document.getElementById("entry-date").value = expense.date;
    document.getElementById("desc").value = expense.description;
    document.getElementById("amount").value = expense.is_amortized && expense.original_amount
        ? expense.original_amount
        : expense.amount;
    document.getElementById("months").value = expense.is_amortized ? expense.amortization_months : 1;
    document.getElementById("category").value = expense.category;
    document.getElementById("unit").value = expense.unit || "months";
    document.getElementById("skip-weekends").checked = Boolean(expense.skip_weekends);
    document.getElementById("type").value = expense.type || "expense";
    selectType(expense.type || "expense");
    toggleWeekendOption();
    document.getElementById("item-modal").classList.remove("hidden");
}


async function deleteExpenseWrapper(id, isAmortized, groupId) {
    if (isAmortized && groupId) {
        const deleteSeries = confirm("这是一条分期记录。\n确定删除整组分期？\n点击“取消”将只删除当前这一期。");
        await fetch(`${API_URL}/expenses/${id}?delete_series=${deleteSeries}`, { method: "DELETE" });
    } else {
        await fetch(`${API_URL}/expenses/${id}`, { method: "DELETE" });
    }

    await refreshAll();
}


async function debugDeleteAll() {
    if (!confirm("确定删除全部记录？此操作不可恢复。")) return;
    const response = await fetch(`${API_URL}/expenses`, { method: "DELETE" });
    const data = await response.json();
    alert(data.message || "删除完成");
    await refreshAll();
}


function openAddCategoryModal() {
    const modal = document.getElementById("category-modal");
    const picker = document.getElementById("emoji-picker");
    picker.innerHTML = "";
    document.getElementById("new-cat-name").value = "";
    document.getElementById("new-cat-icon").value = "";

    emojiList.forEach((emoji) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "emoji-btn";
        button.textContent = emoji;
        button.onclick = () => {
            document.getElementById("new-cat-icon").value = emoji;
        };
        picker.appendChild(button);
    });

    renderCategoriesList();
    modal.classList.remove("hidden");
}


function renderCategoriesList() {
    const container = document.getElementById("categories-list-container");
    container.innerHTML = "";

    categoriesList.forEach((category) => {
        const item = document.createElement("div");
        item.className = "category-list-item";
        item.innerHTML = `
            <div class="cat-item-info">
                <span class="cat-item-icon">${category.icon}</span>
                <span>${category.name}</span>
            </div>
            <button class="btn-delete-cat" onclick="deleteCategory(${category.id}, '${category.name.replace(/'/g, "\\'")}')">🗑</button>
        `;
        container.appendChild(item);
    });
}


async function deleteCategory(id, name) {
    if (!confirm(`删除分类“${name}”？`)) return;
    const response = await fetch(`${API_URL}/categories/${id}`, { method: "DELETE" });
    if (!response.ok) {
        alert("删除分类失败");
        return;
    }

    await fetchCategories();
    renderCategoriesList();
    applyFilters(false);
    await renderCurrentView();
}


async function createRule(keyword, category) {
    const response = await fetch(`${API_URL}/rules`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keyword, category }),
    });

    if (!response.ok) {
        const error = await response.json();
        alert(error.detail || "创建规则失败");
        return;
    }

    document.getElementById("rule-keyword").value = "";
    await fetchRules();
}


async function deleteRule(id) {
    if (!confirm("删除这条规则？")) return;
    await fetch(`${API_URL}/rules/${id}`, { method: "DELETE" });
    await fetchRules();
}


function renderImportPreview(data) {
    const summary = document.getElementById("import-preview-summary");
    const list = document.getElementById("import-preview-list");
    importPreviewCache = data;

    summary.innerHTML = `
        <div class="preview-pill">解析到 ${data.total_parsed} 条</div>
        <div class="preview-pill success">可新增 ${data.new_candidates} 条</div>
        <div class="preview-pill ${data.duplicate_candidates > 0 ? "warning" : "success"}">重复候选 ${data.duplicate_candidates} 条</div>
    `;

    list.innerHTML = data.preview_items.length > 0
        ? data.preview_items.map((item) => `
            <div class="preview-row ${item.duplicate ? "duplicate" : ""}">
                <div class="preview-row-top">
                    <strong>${item.description}</strong>
                    <span class="${item.type === "income" ? "income-amount" : "expense-amount"}">
                        ${item.type === "income" ? "+" : "-"}${formatCurrency(Math.abs(item.amount))}
                    </span>
                </div>
                <div class="preview-row-meta">
                    <span>${item.date}</span>
                    <span>${item.category}</span>
                    <span>${item.duplicate ? "疑似重复" : "将导入"}</span>
                </div>
                <div class="preview-row-note">${item.explanation}</div>
            </div>
        `).join("")
        : '<div class="empty-state">没有可预览的数据</div>';
}


async function previewImportFile() {
    const source = document.getElementById("import-source").value;
    const file = document.getElementById("import-file").files[0];
    if (!file) {
        setStatus("import-status", "请先选择账单文件", "danger");
        return;
    }

    setStatus("import-status", "正在生成导入预览...", "warning");

    const formData = new FormData();
    formData.append("file", file);

    try {
        const response = await fetch(`${API_URL}/import/${source}/preview`, {
            method: "POST",
            body: formData,
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || "预览失败");
        }

        const data = await response.json();
        renderImportPreview(data);
        setStatus("import-status", "预览已生成，可以检查规则命中与重复项", "success");
    } catch (error) {
        console.error(error);
        setStatus("import-status", `预览失败：${error.message}`, "danger");
    }
}


async function uploadImportFile() {
    const source = document.getElementById("import-source").value;
    const file = document.getElementById("import-file").files[0];
    if (!file) {
        setStatus("import-status", "请先选择账单文件", "danger");
        return;
    }

    setStatus("import-status", "正在导入账单...", "warning");

    const formData = new FormData();
    formData.append("file", file);

    try {
        const response = await fetch(`${API_URL}/import/${source}`, {
            method: "POST",
            body: formData,
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || "导入失败");
        }

        const data = await response.json();
        setStatus("import-status", data.message, "success");
        await refreshAll();
    } catch (error) {
        console.error(error);
        setStatus("import-status", `导入失败：${error.message}`, "danger");
    }
}


async function openImportModal() {
    document.getElementById("import-modal").classList.remove("hidden");
    document.getElementById("import-preview-summary").innerHTML = '<div class="empty-state">尚未生成预览</div>';
    document.getElementById("import-preview-list").innerHTML = "";
    importPreviewCache = null;
    setStatus("import-status", "", "neutral");
    await fetchRules();
}


async function openDevMode() {
    const response = await fetch(`${API_URL}/expenses`);
    const rawData = await response.json();
    rawData.sort((left, right) => left.id - right.id);
    document.getElementById("jsonl-editor").value = rawData.map((item) => JSON.stringify(item)).join("\n");
    document.getElementById("dev-modal").classList.remove("hidden");
}


async function saveDevMode() {
    if (!confirm("保存会用编辑器内容覆盖当前全部流水，确定继续？")) return;

    const content = document.getElementById("jsonl-editor").value;
    const items = [];
    let invalidLines = 0;

    content.split("\n").forEach((line) => {
        if (!line.trim()) return;
        try {
            items.push(JSON.parse(line));
        } catch (error) {
            invalidLines += 1;
        }
    });

    if (invalidLines > 0 && !confirm(`有 ${invalidLines} 行不是合法 JSON，仍继续导入剩余 ${items.length} 行？`)) {
        return;
    }

    const response = await fetch(`${API_URL}/expenses/bulk_replace`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(items),
    });

    if (!response.ok) {
        const error = await response.json();
        alert(`保存失败：${JSON.stringify(error.detail || error)}`);
        return;
    }

    alert(`已覆盖导入 ${items.length} 条记录`);
    document.getElementById("dev-modal").classList.add("hidden");
    await refreshAll();
}


async function downloadBackup() {
    try {
        setStatus("backup-status", "正在生成备份...", "warning");
        const response = await fetch(`${API_URL}/backup/export`);
        if (!response.ok) throw new Error("备份导出失败");

        const data = await response.json();
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = `realcredit-backup-${new Date().toISOString().slice(0, 10)}.json`;
        anchor.click();
        URL.revokeObjectURL(url);
        setStatus("backup-status", "备份已下载", "success");
    } catch (error) {
        console.error(error);
        setStatus("backup-status", `导出失败：${error.message}`, "danger");
    }
}


async function restoreBackup() {
    const file = document.getElementById("backup-file").files[0];
    if (!file) {
        setStatus("backup-status", "请先选择备份文件", "danger");
        return;
    }

    if (!confirm("恢复备份会覆盖当前所有数据，确定继续？")) return;

    try {
        setStatus("backup-status", "正在恢复备份...", "warning");
        const text = await file.text();
        const payload = JSON.parse(text);

        const response = await fetch(`${API_URL}/backup/import`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || "恢复失败");
        }

        const data = await response.json();
        setStatus("backup-status", `${data.message}，已恢复 ${data.expenses} 条记录`, "success");
        await refreshAll();
    } catch (error) {
        console.error(error);
        setStatus("backup-status", `恢复失败：${error.message}`, "danger");
    }
}


function setupEventListeners() {
    document.getElementById("daily-view-btn").onclick = async () => {
        currentView = "daily";
        updateViewButtons();
        await renderCurrentView();
    };

    document.getElementById("monthly-view-btn").onclick = async () => {
        currentView = "monthly";
        updateViewButtons();
        await renderCurrentView();
    };

    document.getElementById("calendar-view-btn").onclick = async () => {
        currentView = "calendar";
        updateViewButtons();
        await renderCurrentView();
    };

    document.getElementById("prev-days").onclick = async () => {
        if (currentView === "daily") {
            currentDate.setDate(currentDate.getDate() - 7);
        } else if (currentView === "monthly") {
            currentDate.setMonth(currentDate.getMonth() - 12);
        } else {
            currentDate.setMonth(currentDate.getMonth() - 1);
        }
        await renderCurrentView();
    };

    document.getElementById("next-days").onclick = async () => {
        if (currentView === "daily") {
            currentDate.setDate(currentDate.getDate() + 7);
        } else if (currentView === "monthly") {
            currentDate.setMonth(currentDate.getMonth() + 12);
        } else {
            currentDate.setMonth(currentDate.getMonth() + 1);
        }
        await renderCurrentView();
    };

    document.getElementById("today-btn").onclick = async () => {
        currentDate = new Date();
        await renderCurrentView();
    };

    document.getElementById("search-input").addEventListener("input", (event) => {
        filters.search = normalizeText(event.target.value);
        applyFilters();
    });

    document.getElementById("type-filter").addEventListener("change", (event) => {
        filters.type = event.target.value;
        applyFilters();
    });

    document.getElementById("category-filter").addEventListener("change", (event) => {
        filters.category = event.target.value;
        applyFilters();
    });

    document.getElementById("amortization-filter").addEventListener("change", (event) => {
        filters.amortization = event.target.value;
        applyFilters();
    });

    document.getElementById("clear-filters-btn").onclick = () => {
        filters.search = "";
        filters.type = "all";
        filters.category = "all";
        filters.amortization = "all";
        document.getElementById("search-input").value = "";
        document.getElementById("type-filter").value = "all";
        document.getElementById("category-filter").value = "all";
        document.getElementById("amortization-filter").value = "all";
        applyFilters();
    };

    document.getElementById("cancel-btn").onclick = () => {
        document.getElementById("item-modal").classList.add("hidden");
    };

    document.getElementById("item-form").onsubmit = async (event) => {
        event.preventDefault();
        const payload = {
            description: document.getElementById("desc").value,
            amount: parseFloat(document.getElementById("amount").value),
            category: document.getElementById("category").value,
            amortization_months: parseInt(document.getElementById("months").value, 10) || 1,
            date: document.getElementById("entry-date").value,
            type: document.getElementById("type").value,
            unit: document.getElementById("unit").value,
            skip_weekends: document.getElementById("skip-weekends").checked,
        };

        try {
            await createExpense(payload);
            document.getElementById("item-modal").classList.add("hidden");
            await refreshAll();
        } catch (error) {
            console.error(error);
            alert(error.message || "保存失败");
        }
    };

    document.getElementById("close-cat-btn").onclick = () => {
        document.getElementById("category-modal").classList.add("hidden");
    };

    document.getElementById("category-form").onsubmit = async (event) => {
        event.preventDefault();
        const name = document.getElementById("new-cat-name").value.trim();
        const icon = document.getElementById("new-cat-icon").value.trim();
        if (!name || !icon) return;

        const response = await fetch(`${API_URL}/categories`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name, icon }),
        });

        if (!response.ok) {
            const error = await response.json();
            alert(error.detail || "创建分类失败");
            return;
        }

        await fetchCategories();
        renderCategoriesList();
        document.getElementById("category").value = name;
        document.getElementById("new-cat-name").value = "";
        document.getElementById("new-cat-icon").value = "";
    };

    document.getElementById("rule-form").onsubmit = async (event) => {
        event.preventDefault();
        const keyword = document.getElementById("rule-keyword").value.trim();
        const category = document.getElementById("rule-category").value;
        if (!keyword || !category) return;
        await createRule(keyword, category);
    };

    document.getElementById("import-btn-nav").onclick = openImportModal;
    document.getElementById("close-import-btn").onclick = () => {
        document.getElementById("import-modal").classList.add("hidden");
    };
    document.getElementById("preview-upload-btn").onclick = previewImportFile;
    document.getElementById("upload-btn").onclick = uploadImportFile;

    document.getElementById("backup-btn-nav").onclick = () => {
        document.getElementById("backup-modal").classList.remove("hidden");
        setStatus("backup-status", "", "neutral");
    };
    document.getElementById("close-backup-btn").onclick = () => {
        document.getElementById("backup-modal").classList.add("hidden");
    };
    document.getElementById("download-backup-btn").onclick = downloadBackup;
    document.getElementById("restore-backup-btn").onclick = restoreBackup;

    document.getElementById("dev-mode-btn").onclick = openDevMode;
    document.getElementById("close-dev-btn").onclick = () => {
        document.getElementById("dev-modal").classList.add("hidden");
    };
    document.getElementById("cancel-dev-btn").onclick = () => {
        document.getElementById("dev-modal").classList.add("hidden");
    };
    document.getElementById("save-dev-btn").onclick = saveDevMode;

    document.getElementById("theme-toggle-btn").onclick = toggleTheme;
}


function updateViewButtons() {
    document.getElementById("daily-view-btn").classList.toggle("active", currentView === "daily");
    document.getElementById("monthly-view-btn").classList.toggle("active", currentView === "monthly");
    document.getElementById("calendar-view-btn").classList.toggle("active", currentView === "calendar");
}


function toggleTheme() {
    const html = document.documentElement;
    const current = html.getAttribute("data-theme");
    const next = current === "light" ? "dark" : "light";
    html.setAttribute("data-theme", next);
    localStorage.setItem("theme", next);
    document.getElementById("theme-toggle-btn").textContent = next === "light" ? "🌙" : "☀️";
}


function loadTheme() {
    const forcedTheme = new URLSearchParams(window.location.search).get("theme");
    const initialTheme = forcedTheme === "light" || forcedTheme === "dark"
        ? forcedTheme
        : (localStorage.getItem("theme") || "dark");

    document.documentElement.setAttribute("data-theme", initialTheme);
    document.getElementById("theme-toggle-btn").textContent = initialTheme === "light" ? "🌙" : "☀️";
}


window.openModal = function openModal(dateStr) {
    document.getElementById("modal-title").textContent = "新增记录";
    document.getElementById("expense-id").value = "";
    document.getElementById("entry-date").value = dateStr;
    document.getElementById("desc").value = "";
    document.getElementById("amount").value = "";
    document.getElementById("months").value = 1;
    document.getElementById("type").value = "expense";
    document.getElementById("unit").value = "months";
    document.getElementById("skip-weekends").checked = false;
    selectType("expense");
    toggleWeekendOption();
    document.getElementById("item-modal").classList.remove("hidden");
    document.getElementById("desc").focus();
};


window.selectType = function selectType(type) {
    document.getElementById("type").value = type;
    document.querySelectorAll(".type-option").forEach((element) => {
        element.classList.toggle("active", element.dataset.type === type);
    });
};


window.toggleWeekendOption = function toggleWeekendOption() {
    const unit = document.getElementById("unit").value;
    document.getElementById("weekend-option").style.display = unit === "days" ? "block" : "none";
};


window.deleteCategory = deleteCategory;
window.deleteRule = deleteRule;
window.editExpense = editExpense;
window.deleteExpenseWrapper = deleteExpenseWrapper;
window.updateBudget = updateBudget;


async function init() {
    loadTheme();
    setupEventListeners();
    updateViewButtons();

    try {
        await refreshAll();
    } catch (error) {
        console.error(error);
        document.getElementById("board").innerHTML = `<div class="error-message">加载失败：${error.message}</div>`;
    }
}


document.addEventListener("DOMContentLoaded", init);
