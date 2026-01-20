const API_URL = 'http://localhost:8000';
let currentDate = new Date();
let expenses = [];
let monthBudget = 0;
let currentView = 'daily'; // 'daily', 'monthly', or 'calendar'
let categoriesList = [];
let categoryIcons = {};

const emojiList = [
    '🍔', '🚗', '🛍️', '🏠', '🎬', '💡', '💰', '💼', '📈', '📦',
    '🐱', '🐶', '🍕', '🍺', '🎮', '✈️', '🏥', '📚', '🎁', '💅',
    '🏋️', '🚕', '🥖', '🍎', '🍼', '🎓', '💸', '🏦', '🎨', '🎵'
];

async function fetchBudget(dateObj) {
    const monthStr = dateObj.toISOString().slice(0, 7); // YYYY-MM
    try {
        const res = await fetch(`${API_URL}/budgets/${monthStr}`);
        if (!res.ok) return;
        const data = await res.json();
        monthBudget = data.amount;

        const budgetWidget = document.getElementById('budget-widget');
        const budgetInput = document.getElementById('month-budget-input');

        if (currentView === 'daily') {
            budgetWidget.style.display = 'flex';
            budgetInput.value = monthBudget > 0 ? monthBudget : ''; // Show empty if 0
        } else {
            budgetWidget.style.display = 'none';
        }

    } catch (e) {
        console.error("获取预算失败", e);
    }
}

async function updateBudget() {
    const amount = parseFloat(document.getElementById('month-budget-input').value) || 0;
    const monthStr = currentDate.toISOString().slice(0, 7); // YYYY-MM

    try {
        await fetch(`${API_URL}/budgets`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ month: monthStr, amount })
        });
        monthBudget = amount;
        renderBoard(currentDate); // Re-render to show updated status
    } catch (e) {
        console.error("更新预算失败", e);
    }
}

async function init() {
    loadTheme();
    setupEventListeners(); // Setup listeners immediately so UI is responsive

    try {
        await fetchCategories();
        await fetchExpenses();
        await fetchBudget(currentDate);
        renderBoard(currentDate);
    } catch (e) {
        console.error("初始化错误 (部分):", e);
        // Even if some fetches fail, we try to render what we can or at least leave UI responsive
    }
}

async function fetchExpenses() {
    try {
        // Fetch wide range just in case. Optimization: fetch dynamic window.
        // For now, fetch all.
        const res = await fetch(`${API_URL}/expenses`);
        if (!res.ok) throw new Error(`加载支出失败: ${res.statusText}`);
        expenses = await res.json();
    } catch (e) {
        console.error("获取支出失败", e);
        document.getElementById('board').innerHTML = `<div class="error-message">❌ 加载数据失败。后端是否在运行？<br>${e.message}</div>`;
        throw e;
    }
}

async function fetchCategories() {
    try {
        const res = await fetch(`${API_URL}/categories`);
        if (!res.ok) return;
        categoriesList = await res.json();

        // Update icons map
        categoryIcons = {};
        categoriesList.forEach(c => {
            categoryIcons[c.name] = c.icon;
        });

        populateCategorySelect();
    } catch (e) {
        console.error("获取分类失败", e);
    }
}

function populateCategorySelect() {
    const select = document.getElementById('category');
    select.innerHTML = '';

    categoriesList.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.name;
        opt.textContent = `${c.icon} ${c.name}`;
        select.appendChild(opt);
    });

    // Add option to create new
    const newOpt = document.createElement('option');
    newOpt.value = '__NEW__';
    newOpt.textContent = '➕ 添加新分类...';
    select.appendChild(newOpt);

    select.onchange = (e) => {
        const val = e.target.value;
        if (val === '__NEW__') {
            openAddCategoryModal();
            // Reset selection to first item temporarily until new one is added
            if (categoriesList.length > 0) select.value = categoriesList[0].name;
        } else {
            // Auto-detect type
            const incomeKeywords = ['Salary', 'Business', 'Investment', 'Refund', 'Bonus', 'Income', '工资', '兼职', '投资', '理财', '退款', '奖金', '收入'];
            const isIncome = incomeKeywords.some(keyword => val.includes(keyword));

            if (isIncome) {
                selectType('income');
            } else {
                selectType('expense');
            }
        }
    };
}


function getExpensesForDate(dateStr) {
    return expenses.filter(e => e.date === dateStr);
}

// Add Debug Button Listener
document.addEventListener('DOMContentLoaded', () => {
    const debugBtn = document.createElement('button');
    debugBtn.textContent = '🐞 调试：全部删除';
    debugBtn.className = 'btn-delete';
    debugBtn.style.position = 'fixed';
    debugBtn.style.bottom = '20px';
    debugBtn.style.right = '20px';
    debugBtn.style.zIndex = '9999';
    debugBtn.style.opacity = '0.7';
    debugBtn.onclick = debugDeleteAll;
    document.body.appendChild(debugBtn);
});

function getExpensesForMonth(year, month) {
    // month is 1-indexed (1 = January, 12 = December)
    return expenses.filter(e => {
        const expenseDate = new Date(e.date);
        return expenseDate.getFullYear() === year && expenseDate.getMonth() + 1 === month;
    });
}

function aggregateByCategory(monthExpenses) {
    const categoryTotals = {};
    let expenseTotal = 0;
    let incomeTotal = 0;

    monthExpenses.forEach(expense => {
        const category = expense.category || 'Other';
        if (!categoryTotals[category]) {
            categoryTotals[category] = { expense: 0, income: 0 };
        }

        if (expense.type === 'income') {
            categoryTotals[category].income += Math.abs(expense.amount);
            incomeTotal += Math.abs(expense.amount);
        } else {
            categoryTotals[category].expense += Math.abs(expense.amount);
            expenseTotal += Math.abs(expense.amount);
        }
    });

    return { categoryTotals, expenseTotal, incomeTotal, netTotal: incomeTotal - expenseTotal };
}


function formatDate(date) {
    // YYYY-MM-DD
    return date.toISOString().split('T')[0];
}

function renderBoard(centerDate) {
    const board = document.getElementById('board');
    board.innerHTML = '';

    // Show 7 days (one week) centered around current date
    let start = new Date(centerDate);
    start.setDate(start.getDate() - 3); // Show 3 days back

    // Show 7 days total (one week)
    for (let i = 0; i < 7; i++) {

        const d = new Date(start);
        d.setDate(d.getDate() + i);
        const dateStr = formatDate(d);

        // Budget Calculations
        let budgetStatusHtml = '';
        if (monthBudget > 0) {
            // Get user's timezone based days in month? Simplest is:
            const daysInMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
            const dailyLimit = monthBudget / daysInMonth;

            // Calculate today's expense stats
            // We need to sum up expenses for this day
            const dayItems = getExpensesForDate(dateStr);
            let dayExpenseTotal = 0;
            dayItems.forEach(item => {
                // Case-insensitive check just in case data was saved differently
                const type = (item.type || '').toLowerCase();
                if (type !== 'income') {
                    // For amortized items, we should technically count their daily portion? 
                    // But getExpensesForDate returns the amortized split item for this day with its specific amount.
                    // So just summing amount is correct.
                    dayExpenseTotal += Math.abs(item.amount);
                }
            });

            const isOver = dayExpenseTotal > dailyLimit;
            const statusColor = isOver ? '#EF4444' : '#10B981'; // Red or Green
            const percent = Math.min((dayExpenseTotal / dailyLimit) * 100, 100);

            budgetStatusHtml = `
                <div class="daily-budget-status">
                    <div class="budget-bar">
                        <div class="budget-fill" style="width: ${percent}%; background: ${statusColor}"></div>
                    </div>
                    <div class="budget-text" style="color: ${statusColor}">
                        ¥${dayExpenseTotal.toFixed(0)} / ¥${dailyLimit.toFixed(0)}
                    </div>
                </div>
            `;
        }

        // Update Total Budget Progress (Once per render)
        if (i === 0) {
            updateTotalBudgetProgress(d.getFullYear(), d.getMonth() + 1);
        }

        const col = document.createElement('div');
        col.className = 'column';
        if (dateStr === formatDate(new Date())) col.classList.add('current-day-col');

        const dateObj = new Date(dateStr);
        const dayName = dateObj.toLocaleDateString('zh-CN', { weekday: 'short' });
        const prettyDate = dateObj.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });

        const items = getExpensesForDate(dateStr);

        let itemsHtml = items.map(item => {
            // Build amount display
            let amountHtml = '';
            const type = (item.type || '').toLowerCase();
            const isIncome = type === 'income';

            // Handle display of potentially negative values from DB
            const absAmount = Math.abs(item.amount);
            const amountPrefix = isIncome ? '+' : '-';
            const amountClass = isIncome ? 'income-amount' : 'expense-amount';

            if (item.is_amortized && item.original_amount) {
                // Determine display labels based on unit
                const unitLabel = item.unit === 'days' ? '天' : '月';
                const periodLabel = item.unit === 'days' ? '天' : '月';
                const absTotal = Math.abs(item.original_amount);

                amountHtml = `
                    <div class="amount-display">
                        <span class="amortized-amount ${amountClass}">${amountPrefix}¥${absAmount.toFixed(2)}</span>
                        <span class="original-amount">(¥${absTotal.toFixed(2)} / ${item.amortization_months}${unitLabel})</span>
                        <span class="amortization-indicator">${periodLabel} ${item.amortization_index + 1}/${item.amortization_months}</span>
                    </div>
                `;
            } else {
                amountHtml = `<span class="card-amount ${amountClass}">${amountPrefix}¥${absAmount.toFixed(2)}</span>`;
            }

            return `
                <div class="expense-card ${isIncome ? 'income-card' : ''}">
                    <div class="card-top">
                        <span class="card-desc">${item.description}</span>
                        ${amountHtml}
                    </div>
                    <div class="card-footer">
                        <div class="card-tags">
                            <span class="tag">${item.category}</span>
                            ${item.is_amortized ? '<span class="tag amortized">分摊</span>' : ''}
                            ${isIncome ? '<span class="tag income-tag">收入</span>' : ''}
                        </div>
                        <div class="card-actions-compact">
                            <button class="btn-icon" title="编辑" onclick="event.stopPropagation(); editExpense(${item.id})">✏️</button>
                            <button class="btn-icon delete" title="删除" onclick="event.stopPropagation(); deleteExpenseWrapper(${item.id}, ${item.is_amortized}, '${item.group_id || ''}')">🗑️</button>
                        </div>
                    </div>
                </div>
            `;
        }).join('');


        col.innerHTML = `
            <div class="column-header">
                <div class="date-text">${prettyDate}</div>
                <div class="day-text">${dayName}</div>
                ${budgetStatusHtml}
            </div>
            <div class="column-content" id="col-${dateStr}">
                ${itemsHtml}
                <div class="add-placeholder" onclick="openModal('${dateStr}')">
                    + 添加记录
                </div>
            </div>
        `;

        board.appendChild(col);
    }
}

function updateTotalBudgetProgress(year, month) {
    const container = document.getElementById('total-budget-container');

    if (monthBudget <= 0) {
        container.style.display = 'none';
        return;
    }

    container.style.display = 'flex';

    // Calculate total expenses for the month
    const monthExpenses = getExpensesForMonth(year, month);
    // Reuse existing aggregation logic
    const { expenseTotal } = aggregateByCategory(monthExpenses);

    const percent = Math.min((expenseTotal / monthBudget) * 100, 100);
    const isOver = expenseTotal > monthBudget;
    const color = isOver ? '#EF4444' : '#10B981';

    const fill = document.getElementById('total-budget-fill');
    fill.style.width = `${percent}%`;
    fill.style.backgroundColor = color;

    const text = document.getElementById('total-budget-text');
    text.textContent = `¥${expenseTotal.toFixed(0)} / ¥${monthBudget.toFixed(0)} (${percent.toFixed(0)}%)`;
    text.style.color = color;
}

function renderMonthlyBoard(centerDate) {
    const board = document.getElementById('board');
    board.innerHTML = '';

    // Show 12 months centered around centerDate
    const centerYear = centerDate.getFullYear();
    const centerMonth = centerDate.getMonth() + 1; // 1-indexed

    // Calculate start month (6 months before center)
    let startYear = centerYear;
    let startMonth = centerMonth - 5;

    if (startMonth <= 0) {
        startYear--;
        startMonth += 12;
    }

    // Generate 12 month columns
    for (let i = 0; i < 12; i++) {
        let year = startYear;
        let month = startMonth + i;

        if (month > 12) {
            year++;
            month -= 12;
        }

        const monthExpenses = getExpensesForMonth(year, month);
        const { categoryTotals, expenseTotal, incomeTotal, netTotal } = aggregateByCategory(monthExpenses);

        const col = document.createElement('div');
        col.className = 'month-column';

        // Check if this is the current month
        const today = new Date();
        if (year === today.getFullYear() && month === today.getMonth() + 1) {
            col.classList.add('current-day-col');
        }

        const monthName = new Date(year, month - 1, 1).toLocaleDateString('zh-CN', { month: 'long' });

        // Build category breakdown HTML
        let categoryHtml = '';
        const sortedCategories = Object.entries(categoryTotals).sort((a, b) => {
            const totalA = a[1].expense + a[1].income;
            const totalB = b[1].expense + b[1].income;
            return totalB - totalA;
        });

        if (sortedCategories.length > 0) {
            categoryHtml = sortedCategories.map(([category, amounts]) => {
                const total = amounts.expense + amounts.income;
                return `
                <div class="category-item">
                    <span class="category-name">${categoryIcons[category] || '📝'} ${category}</span>
                    <div class="category-amounts">
                        ${amounts.income > 0 ? `<span class="income-amount">+¥${amounts.income.toFixed(2)}</span>` : ''}
                        ${amounts.expense > 0 ? `<span class="expense-amount">-¥${amounts.expense.toFixed(2)}</span>` : ''}
                    </div>
                </div>
            `;
            }).join('');
        } else {
            categoryHtml = '<div class="category-item" style="border:none; justify-content:center; color:var(--text-secondary);">无交易</div>';
        }

        col.innerHTML = `
            <div class="column-header">
                <div class="date-text">${monthName}</div>
                <div class="day-text">${year}</div>
            </div>
            <div class="month-summary">
                <div class="month-breakdown">
                    ${incomeTotal > 0 ? `<div class="income-total">+¥${incomeTotal.toFixed(2)}</div>` : ''}
                    ${expenseTotal > 0 ? `<div class="expense-total">-¥${expenseTotal.toFixed(2)}</div>` : ''}
                </div>
                <div class="month-total ${netTotal >= 0 ? 'positive' : 'negative'}">¥${netTotal.toFixed(2)}</div>
                <div class="month-label">净总额</div>
            </div>
            <div class="category-breakdown">
                ${categoryHtml}
            </div>
        `;

        board.appendChild(col);
    }
}

function renderCalendarView(centerDate) {
    const board = document.getElementById('board');
    board.innerHTML = '';

    const year = centerDate.getFullYear();
    const month = centerDate.getMonth(); // 0-indexed

    // Create calendar container
    const calendarContainer = document.createElement('div');
    calendarContainer.className = 'calendar-view';

    // Calendar header
    const monthName = new Date(year, month, 1).toLocaleDateString('zh-CN', { month: 'long', year: 'numeric' });
    const header = document.createElement('div');
    header.className = 'calendar-header';
    header.innerHTML = `<h2>${monthName}</h2>`;
    calendarContainer.appendChild(header);

    // Weekday headers
    const weekdayHeaders = document.createElement('div');
    weekdayHeaders.className = 'calendar-weekdays';
    const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
    weekdays.forEach(day => {
        const dayHeader = document.createElement('div');
        dayHeader.className = 'weekday-header';
        dayHeader.textContent = day;
        weekdayHeaders.appendChild(dayHeader);
    });
    calendarContainer.appendChild(weekdayHeaders);

    // Calendar grid
    const calendarGrid = document.createElement('div');
    calendarGrid.className = 'calendar-grid';

    // Get first day of month and total days
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    // Add empty cells for days before month starts
    for (let i = 0; i < firstDay; i++) {
        const emptyCell = document.createElement('div');
        emptyCell.className = 'calendar-day empty';
        calendarGrid.appendChild(emptyCell);
    }

    // Add cells for each day of the month
    for (let day = 1; day <= daysInMonth; day++) {
        const dateObj = new Date(year, month, day);
        const dateStr = formatDate(dateObj);
        const dayExpenses = getExpensesForDate(dateStr);

        // Calculate totals
        let expenseTotal = 0;
        let incomeTotal = 0;
        dayExpenses.forEach(item => {
            const type = (item.type || '').toLowerCase();
            if (type === 'income') {
                incomeTotal += Math.abs(item.amount);
            } else {
                expenseTotal += Math.abs(item.amount);
            }
        });

        const netTotal = incomeTotal - expenseTotal;
        const netTotalAbs = Math.abs(netTotal);
        // Format string with negative sign before currency symbol
        const netTotalStr = netTotal >= 0 ? `¥${netTotal.toFixed(2)}` : `-¥${netTotalAbs.toFixed(2)}`;

        const dayCell = document.createElement('div');
        dayCell.className = 'calendar-day';

        // Highlight today
        const today = new Date();
        if (dateStr === formatDate(today)) {
            dayCell.classList.add('today');
        }

        dayCell.innerHTML = `
            <div class="day-number">${day}</div>
            ${dayExpenses.length > 0 ? `
                <div class="day-summary">
                    ${incomeTotal > 0 ? `<div class="income-total">+¥${incomeTotal.toFixed(2)}</div>` : ''}
                    ${expenseTotal > 0 ? `<div class="expense-total">-¥${expenseTotal.toFixed(2)}</div>` : ''}
                    <div class="net-total ${netTotal >= 0 ? 'positive' : 'negative'}">${netTotalStr}</div>
                </div>
            ` : '<div class="day-empty">-</div>'}
        `;

        dayCell.onclick = () => openDayDetail(dateStr);
        calendarGrid.appendChild(dayCell);
    }

    calendarContainer.appendChild(calendarGrid);
    board.appendChild(calendarContainer);
}

function openDayDetail(dateStr) {
    // For now, just open the add modal for that date
    // In the future, could show a detailed view of all transactions
    openModal(dateStr);
}



function setupEventListeners() {
    // View toggle listeners
    document.getElementById('daily-view-btn').onclick = () => {
        currentView = 'daily';
        document.getElementById('daily-view-btn').classList.add('active');
        document.getElementById('monthly-view-btn').classList.remove('active');
        document.getElementById('calendar-view-btn').classList.remove('active');
        document.getElementById('budget-widget').style.display = 'flex'; // Show budget
        renderBoard(currentDate);
    };

    document.getElementById('monthly-view-btn').onclick = () => {
        currentView = 'monthly';
        document.getElementById('monthly-view-btn').classList.add('active');
        document.getElementById('daily-view-btn').classList.remove('active');
        document.getElementById('calendar-view-btn').classList.remove('active');
        document.getElementById('budget-widget').style.display = 'none'; // Hide budget
        renderMonthlyBoard(currentDate);
    };

    document.getElementById('calendar-view-btn').onclick = () => {
        currentView = 'calendar';
        document.getElementById('calendar-view-btn').classList.add('active');
        document.getElementById('daily-view-btn').classList.remove('active');
        document.getElementById('monthly-view-btn').classList.remove('active');
        document.getElementById('budget-widget').style.display = 'none'; // Hide budget
        renderCalendarView(currentDate);
    };

    // Navigation - dynamic based on view
    document.getElementById('prev-days').onclick = () => {
        if (currentView === 'daily') {
            currentDate.setDate(currentDate.getDate() - 7);
            fetchBudget(currentDate).then(() => renderBoard(currentDate)); // Fetch budget for potentially new month
        } else if (currentView === 'monthly') {
            currentDate.setMonth(currentDate.getMonth() - 12);
            renderMonthlyBoard(currentDate);
        } else {
            // Calendar view - go back 1 month
            currentDate.setMonth(currentDate.getMonth() - 1);
            renderCalendarView(currentDate);
        }
    };

    document.getElementById('next-days').onclick = () => {
        if (currentView === 'daily') {
            currentDate.setDate(currentDate.getDate() + 7);
            fetchBudget(currentDate).then(() => renderBoard(currentDate));
        } else if (currentView === 'monthly') {
            currentDate.setMonth(currentDate.getMonth() + 12);
            renderMonthlyBoard(currentDate);
        } else {
            // Calendar view - go forward 1 month
            currentDate.setMonth(currentDate.getMonth() + 1);
            renderCalendarView(currentDate);
        }
    };

    document.getElementById('today-btn').onclick = () => {
        currentDate = new Date();
        if (currentView === 'daily') {
            fetchBudget(currentDate).then(() => renderBoard(currentDate));
        } else if (currentView === 'monthly') {
            renderMonthlyBoard(currentDate);
        } else {
            renderCalendarView(currentDate);
        }
    };



    // Modal
    const modal = document.getElementById('item-modal');
    const form = document.getElementById('item-form');

    document.getElementById('cancel-btn').onclick = () => modal.classList.add('hidden');

    // Category Modal Listeners
    const catModal = document.getElementById('category-modal');
    const catForm = document.getElementById('category-form');

    document.getElementById('close-cat-btn').onclick = () => {
        catModal.classList.add('hidden');
        // Reset category selection
        const select = document.getElementById('category');
        if (categoriesList.length > 0) {
            // Check if current value exists
            if (!categoriesList.find(c => c.name === select.value)) {
                select.value = categoriesList[0].name;
            }
        }
    };

    catForm.onsubmit = async (e) => {
        e.preventDefault();
        const name = document.getElementById('new-cat-name').value;
        const icon = document.getElementById('new-cat-icon').value;

        if (!name || !icon) return;

        try {
            const res = await fetch(`${API_URL}/categories`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, icon })
            });

            if (!res.ok) {
                const err = await res.json();
                alert(err.detail || '创建分类失败');
                return;
            }

            await fetchCategories(); // Refresh list
            renderCategoriesList(); // Refresh modal list

            // Set selection to new category
            const select = document.getElementById('category');
            select.value = name;

            // Clear inputs
            document.getElementById('new-cat-name').value = '';
            document.getElementById('new-cat-icon').value = '';

        } catch (err) {
            console.error(err);
            alert('创建分类错误');
        }
    };

    form.onsubmit = async (e) => {
        e.preventDefault();
        const data = {
            description: document.getElementById('desc').value,
            amount: parseFloat(document.getElementById('amount').value),
            category: document.getElementById('category').value,
            amortization_months: parseInt(document.getElementById('months').value),
            date: document.getElementById('entry-date').value,
            type: document.getElementById('type').value,
            unit: document.getElementById('unit').value,
            skip_weekends: document.getElementById('skip-weekends').checked
        };

        await createExpense(data);
        modal.classList.add('hidden');
        await fetchExpenses();
        if (currentView === 'daily') {
            renderBoard(currentDate);
        } else if (currentView === 'monthly') {
            renderMonthlyBoard(currentDate);
        } else {
            renderCalendarView(currentDate);
        }
    };

    // Developer Mode Listeners
    document.getElementById('dev-mode-btn').onclick = openDevMode;
    document.getElementById('close-dev-btn').onclick = () => document.getElementById('dev-modal').classList.add('hidden');
    document.getElementById('cancel-dev-btn').onclick = () => document.getElementById('dev-modal').classList.add('hidden');
    document.getElementById('save-dev-btn').onclick = saveDevMode;

    // Import Modal Listeners
    document.getElementById('import-btn-nav').onclick = openImportModal;
    document.getElementById('close-import-btn').onclick = () => document.getElementById('import-modal').classList.add('hidden');

    document.getElementById('rule-form').onsubmit = async (e) => {
        e.preventDefault();
        const keyword = document.getElementById('rule-keyword').value;
        const category = document.getElementById('rule-category').value;
        await createRule(keyword, category);
    };

    document.getElementById('upload-btn').onclick = uploadImportFile;

    // Theme Toggle
    const themeBtn = document.getElementById('theme-toggle-btn');
    if (themeBtn) themeBtn.onclick = toggleTheme;
}


// ... existing code ...

async function openImportModal() {
    document.getElementById('import-modal').classList.remove('hidden');
    document.getElementById('import-status').textContent = '';
    fetchRules();
    renderRuleSelect();
}

function renderRuleSelect() {
    const select = document.getElementById('rule-category');
    select.innerHTML = '';
    // Use existing categoriesList global
    categoriesList.forEach(cat => {
        const opt = document.createElement('option');
        opt.value = cat.name;
        opt.textContent = `${cat.icon} ${cat.name}`;
        select.appendChild(opt);
    });
}

async function fetchRules() {
    try {
        const res = await fetch(`${API_URL}/rules`);
        if (!res.ok) return;
        const rules = await res.json();
        renderRules(rules);
    } catch (e) {
        console.error(e);
    }
}

function renderRules(rules) {
    const list = document.getElementById('rules-list');
    list.innerHTML = '';
    rules.forEach(rule => {
        const item = document.createElement('div');
        item.className = 'rule-item';
        item.innerHTML = `
            <div>
                <span class="rule-keyword">${rule.keyword}</span>
                <span class="rule-cat-tag">${rule.category}</span>
            </div>
            <span class="rule-delete" onclick="deleteRule(${rule.id})">✕</span>
        `;
        list.appendChild(item);
    });
}

async function createRule(keyword, category) {
    try {
        const res = await fetch(`${API_URL}/rules`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ keyword, category })
        });
        if (!res.ok) {
            const err = await res.json();
            alert(err.detail);
            return;
        }
        // Clear inputs
        document.getElementById('rule-keyword').value = '';
        document.getElementById('rule-category').value = '';
        fetchRules();
    } catch (e) {
        console.error(e);
    }
}

async function deleteRule(id) {
    if (!confirm('删除规则？')) return;
    await fetch(`${API_URL}/rules/${id}`, { method: 'DELETE' });
    fetchRules();
}

async function uploadImportFile() {
    const source = document.getElementById('import-source').value;
    const input = document.getElementById('import-file');
    const file = input.files[0];
    const status = document.getElementById('import-status');

    if (!file) {
        status.textContent = '请先选择文件。';
        status.style.color = '#EF4444';
        return;
    }

    status.textContent = '正在上传处理...';
    status.style.color = '#FBBF24';

    const formData = new FormData();
    formData.append('file', file);

    const endpoint = source === 'wechat' ? '/import/wechat' : '/import/alipay';

    try {
        const res = await fetch(`${API_URL}${endpoint}`, {
            method: 'POST',
            body: formData
        });

        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.detail || '导入失败');
        }

        const data = await res.json();
        status.textContent = `✅ ${data.message}`;
        status.style.color = '#10B981';

        // Refresh board
        setTimeout(() => {
            document.getElementById('import-modal').classList.add('hidden');
            init();
        }, 1500);

    } catch (e) {
        console.error(e);
        status.textContent = `❌ 错误: ${e.message}`;
        status.style.color = '#EF4444';
    }
}

async function createExpense(data) {
    try {
        const expenseId = document.getElementById('expense-id').value;

        if (expenseId) {
            // Edit mode - PUT request
            const res = await fetch(`${API_URL}/expenses/${expenseId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            if (!res.ok) alert('更新错误');
        } else {
            // Create mode - POST request
            const res = await fetch(`${API_URL}/expenses`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            if (!res.ok) alert('保存错误');
        }
    } catch (e) {
        console.error(e);
    }
}

async function editExpense(id) {
    // Find the expense
    const expense = expenses.find(e => e.id === id);
    if (!expense) return;

    // Populate modal with expense data
    document.getElementById('modal-title').textContent = '编辑记录';
    document.getElementById('expense-id').value = id;
    document.getElementById('entry-date').value = expense.date;
    document.getElementById('desc').value = expense.description;

    // For amortized expenses, show original amount
    if (expense.is_amortized && expense.original_amount) {
        document.getElementById('amount').value = expense.original_amount;
        document.getElementById('months').value = expense.amortization_months;
    } else {
        document.getElementById('amount').value = expense.amount;
        document.getElementById('months').value = 1;
    }

    document.getElementById('category').value = expense.category;

    // Set type
    const expenseType = expense.type || 'expense';
    document.getElementById('type').value = expenseType;
    selectType(expenseType);

    // Show modal
    document.getElementById('item-modal').classList.remove('hidden');
    document.getElementById('desc').focus();
}


async function deleteExpenseWrapper(id, isAmortized, groupId) {
    if (isAmortized && groupId) {
        // Ask if user wants to delete series
        const deleteSeries = confirm('这是一条分摊记录。\n点击确定删除所有相关记录。\n点击取消仅删除此条记录。');
        const url = `${API_URL}/expenses/${id}?delete_series=${deleteSeries}`;
        await fetch(url, { method: 'DELETE' });
    } else {
        // No confirmation for single items as requested
        // if (!confirm('Delete this item?')) return;
        await fetch(`${API_URL}/expenses/${id}`, { method: 'DELETE' });
    }
    init();
}

async function debugDeleteAll() {
    if (!confirm('⚠️ 警告：这将删除所有支出且无法撤销。\n您确定吗？')) return;
    try {
        const res = await fetch(`${API_URL}/expenses`, { method: 'DELETE' });
        const data = await res.json();
        alert(data.message);
        init();
    } catch (e) {
        console.error(e);
        alert('删除全部失败');
    }
}

window.openModal = function (dateStr) {
    document.getElementById('modal-title').textContent = '添加记录';
    document.getElementById('expense-id').value = '';
    document.getElementById('entry-date').value = dateStr;
    document.getElementById('desc').value = '';
    document.getElementById('amount').value = '';
    document.getElementById('months').value = 1;
    document.getElementById('type').value = 'expense';
    document.getElementById('unit').value = 'months';
    document.getElementById('skip-weekends').checked = false;

    // Reset type selector UI
    document.querySelectorAll('.type-option').forEach(opt => opt.classList.remove('active'));
    document.querySelector('.type-option[data-type="expense"]').classList.add('active');

    document.getElementById('item-modal').classList.remove('hidden');
    document.getElementById('desc').focus();
}

window.selectType = function (type) {
    document.getElementById('type').value = type;
    document.querySelectorAll('.type-option').forEach(opt => opt.classList.remove('active'));
    document.querySelector(`.type-option[data-type="${type}"]`).classList.add('active');
}

window.toggleWeekendOption = function () {
    const unit = document.getElementById('unit').value;
    const weekendOption = document.getElementById('weekend-option');
    if (unit === 'days') {
        weekendOption.style.display = 'block';
    } else {
        weekendOption.style.display = 'none';
    }
}

function openAddCategoryModal() {
    const modal = document.getElementById('category-modal');
    const picker = document.getElementById('emoji-picker');
    document.getElementById('new-cat-name').value = '';
    document.getElementById('new-cat-icon').value = '';

    // Populate picker
    picker.innerHTML = '';
    emojiList.forEach(emoji => {
        const btn = document.createElement('div');
        btn.className = 'emoji-btn';
        btn.textContent = emoji;
        btn.onclick = () => {
            document.getElementById('new-cat-icon').value = emoji;
        };
        picker.appendChild(btn);
    });

    renderCategoriesList();

    modal.classList.remove('hidden');
    document.getElementById('new-cat-name').focus();
}

function renderCategoriesList() {
    const container = document.getElementById('categories-list-container');
    container.innerHTML = '';

    categoriesList.forEach(cat => {
        const item = document.createElement('div');
        item.className = 'category-list-item';
        item.innerHTML = `
            <div class="cat-item-info">
                <span class="cat-item-icon">${cat.icon}</span>
                <span>${cat.name}</span>
            </div>
            <button class="btn-delete-cat" onclick="deleteCategory(${cat.id}, '${cat.name}')">🗑️</button>
        `;
        container.appendChild(item);
    });
}

window.deleteCategory = async function (id, name) {
    if (!confirm(`删除分类 "${name}"?`)) return;

    try {
        const res = await fetch(`${API_URL}/categories/${id}`, { method: 'DELETE' });
        if (!res.ok) {
            alert('删除分类错误');
            return;
        }
        await fetchCategories(); // Refresh global list
        renderCategoriesList(); // Refresh modal list
    } catch (e) {
        console.error(e);
        alert('删除失败');
    }
}

async function openDevMode() {
    // 1. Fetch latest raw data
    try {
        const res = await fetch(`${API_URL}/expenses`);
        const rawData = await res.json();

        // 2. Convert to JSONL string
        // Sort by id to keep stable
        rawData.sort((a, b) => a.id - b.id);

        const jsonl = rawData.map(item => JSON.stringify(item)).join('\n');

        // 3. Set to textarea
        const editor = document.getElementById('jsonl-editor');
        editor.value = jsonl;

        // 4. Show modal
        document.getElementById('dev-modal').classList.remove('hidden');

    } catch (e) {
        console.error(e);
        alert("加载开发者模式数据失败");
    }
}

async function saveDevMode() {
    if (!confirm("⚠️ 危险：这将用编辑器内容覆盖整个数据库。\n\n无效行将被忽略，但请确保 JSON 有效。\n\n继续吗？")) return;

    const editor = document.getElementById('jsonl-editor');
    const content = editor.value;

    // Parse
    const lines = content.split('\n');
    const items = [];
    let errorCount = 0;

    for (const line of lines) {
        if (!line.trim()) continue; // Skip empty lines
        try {
            const item = JSON.parse(line);
            // Basic validation? Backend handles most.
            items.push(item);
        } catch (e) {
            errorCount++;
            console.error("无效 JSON 行:", line);
        }
    }

    if (errorCount > 0) {
        if (!confirm(`发现 ${errorCount} 行无效 JSON 将被跳过。\n继续处理 ${items.length} 条有效记录？`)) return;
    }

    // Send to backend
    try {
        const res = await fetch(`${API_URL}/expenses/bulk_replace`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(items)
        });

        if (!res.ok) {
            const err = await res.json();
            alert("保存数据错误:\n" + (err.detail ? JSON.stringify(err.detail) : res.statusText));
            return;
        }

        alert(`成功！已用 ${items.length} 条记录替换数据库。`);
        document.getElementById('dev-modal').classList.add('hidden');

        // Reload everything
        init();

    } catch (e) {
        console.error(e);
        alert("保存期间发生网络或服务器错误。");
    }
}




function toggleTheme() {
    const html = document.documentElement;
    const current = html.getAttribute('data-theme');
    const next = current === 'light' ? 'dark' : 'light';
    html.setAttribute('data-theme', next);

    const btn = document.getElementById('theme-toggle-btn');
    if (btn) btn.textContent = next === 'light' ? '🌙' : '☀️';

    localStorage.setItem('theme', next);
}

function loadTheme() {
    const saved = localStorage.getItem('theme') || 'dark';
    document.documentElement.setAttribute('data-theme', saved);
    const btn = document.getElementById('theme-toggle-btn');
    if (btn) btn.textContent = saved === 'light' ? '🌙' : '☀️';
}

document.addEventListener('DOMContentLoaded', init);
