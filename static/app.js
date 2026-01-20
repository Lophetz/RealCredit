const API_URL = "http://localhost:8000";

// --- State & Navigation ---
function showSection(sectionId) {
    document.querySelectorAll('.view-section').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('nav li').forEach(el => el.classList.remove('active'));

    document.getElementById(sectionId).classList.add('active');
    document.querySelector(`nav li[onclick="showSection('${sectionId}')"]`).classList.add('active');

    const titles = {
        'dashboard': '仪表盘',
        'transactions': '交易明细',
        'assets': '固定资产 & 折旧',
        'accounts': '会计科目'
    };
    document.getElementById('page-title').textContent = titles[sectionId];

    refreshData();
}

// --- Modals ---
function openModal(modalId) {
    document.getElementById(modalId).style.display = "block";
    loadAccountOptions(); // Refresh options when opening forms

    // Set default date to today for new transactions
    if (modalId === 'transaction-modal') {
        document.getElementById('t-date').valueAsDate = new Date();
    }
}

function closeModal(modalId) {
    document.getElementById(modalId).style.display = "none";
}

window.onclick = function (event) {
    if (event.target.classList.contains('modal')) {
        event.target.style.display = "none";
    }
}

// --- Data Fetching ---
async function fetchData(endpoint) {
    const res = await fetch(`${API_URL}${endpoint}`);
    return await res.json();
}

async function postData(endpoint, data) {
    const res = await fetch(`${API_URL}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
    });
    if (!res.ok) {
        const err = await res.json();
        alert(err.detail || "Error occurred");
        throw new Error(err.detail);
    }
    return await res.json();
}

// --- Logic ---

async function refreshData() {
    loadAccounts();
    loadDashboard();
    loadTransactions();
    loadAssets();
}

async function loadAccountOptions() {
    const accounts = await fetchData('/accounts/');
    const selects = ['t-debit-acc', 't-credit-acc', 'fa-asset-acc', 'fa-expense-acc'];
    const typeMap = {
        'Asset': '资产', 'Liability': '负债', 'Equity': '权益',
        'Income': '收入', 'Expense': '支出'
    };

    selects.forEach(id => {
        const select = document.getElementById(id);
        if (!select) return;
        select.innerHTML = '<option value="">选择科目</option>';
        accounts.forEach(acc => {
            const opt = document.createElement('option');
            opt.value = acc.id;
            opt.textContent = `${acc.name} (${typeMap[acc.type] || acc.type})`;
            select.appendChild(opt);
        });
    });
}

async function loadAccounts() {
    const accounts = await fetchData('/accounts/');
    const list = document.getElementById('accounts-list');
    list.innerHTML = '';

    const typeMap = {
        'Asset': '资产', 'Liability': '负债', 'Equity': '权益',
        'Income': '收入', 'Expense': '支出'
    };

    accounts.forEach(acc => {
        const div = document.createElement('div');
        div.className = 'list-item';
        div.innerHTML = `
            <div class="info">
                <h4>${acc.name}</h4>
                <span>${typeMap[acc.type] || acc.type}</span>
            </div>
            <div class="amount">¥${acc.balance.toFixed(2)}</div>
        `;
        list.appendChild(div);
    });
}

async function loadDashboard() {
    const accounts = await fetchData('/accounts/');
    let assets = 0, liabilities = 0;

    accounts.forEach(acc => {
        if (acc.type === 'Asset') assets += acc.balance;
        if (acc.type === 'Liability') liabilities += acc.balance;
    });

    document.getElementById('total-assets').textContent = `¥${assets.toFixed(2)}`;
    document.getElementById('total-liabilities').textContent = `¥${liabilities.toFixed(2)}`;
    document.getElementById('net-worth').textContent = `¥${(assets - liabilities).toFixed(2)}`;
}

async function loadTransactions() {
    try {
        const transactions = await fetchData('/transactions/');
        const list = document.getElementById('all-transactions-list');
        const recentList = document.getElementById('recent-transactions-list');
        list.innerHTML = '';
        recentList.innerHTML = '';

        transactions.reverse().forEach((t, index) => {
            const isVirtualClass = t.is_virtual ? 'virtual-transaction' : '';
            const html = `
                <div class="list-item ${isVirtualClass}">
                    <div class="info">
                        <h4>${t.description}</h4>
                        <span>${new Date(t.date).toLocaleDateString()}</span>
                    </div>
                    <div class="amount">详细</div>
                </div>
            `;
            list.innerHTML += html;
            if (index < 5) recentList.innerHTML += html;
        });
    } catch (e) {
        console.log("Transactions endpoint error", e);
    }
}

async function loadAssets() {
    const assets = await fetchData('/assets/');
    const list = document.getElementById('assets-list');
    list.innerHTML = '';

    assets.forEach(asset => {
        const div = document.createElement('div');
        div.className = 'asset-card';
        div.innerHTML = `
            <h4>${asset.name}</h4>
            <div class="asset-detail">
                <span>原值</span>
                <span>¥${asset.cost.toFixed(2)}</span>
            </div>
            <div class="asset-detail">
                <span>累计折旧</span>
                <span>¥${asset.accumulated_depreciation.toFixed(2)}</span>
            </div>
             <div class="asset-detail">
                <span>账面价值</span>
                <span>¥${(asset.cost - asset.accumulated_depreciation).toFixed(2)}</span>
            </div>
            <div style="margin-top:12px; display:flex; gap:8px;">
                <input type="number" id="depr-months-${asset.id}" value="1" min="1" style="width:60px; padding:8px;" placeholder="月数">
                <button class="depreciate-btn" onclick="depreciateAsset(${asset.id})">计提折旧</button>
            </div>
        `;
        list.appendChild(div);
    });
}

// --- Actions ---

document.getElementById('transaction-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const desc = document.getElementById('t-desc').value;
    const dateVal = document.getElementById('t-date').value;
    const debitAcc = document.getElementById('t-debit-acc').value;
    const creditAcc = document.getElementById('t-credit-acc').value;
    const amount = parseFloat(document.getElementById('t-amount').value);

    if (debitAcc === creditAcc) {
        alert("借贷方科目不能相同");
        return;
    }

    const payload = {
        description: desc,
        date: dateVal ? new Date(dateVal).toISOString() : new Date().toISOString(),
        entries: [
            { account_id: debitAcc, debit: amount, credit: 0 },
            { account_id: creditAcc, debit: 0, credit: amount }
        ]
    };

    try {
        await postData('/transactions/', payload);
        closeModal('transaction-modal');
        e.target.reset();
        refreshData();
    } catch (err) { }
});

document.getElementById('account-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('a-name').value;
    const type = document.getElementById('a-type').value;

    await postData('/accounts/', { name, type });
    closeModal('account-modal');
    e.target.reset();
    refreshData();
});

document.getElementById('asset-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
        name: document.getElementById('fa-name').value,
        cost: parseFloat(document.getElementById('fa-cost').value),
        salvage_value: parseFloat(document.getElementById('fa-salvage').value),
        useful_life_years: parseInt(document.getElementById('fa-life').value),
        purchase_date: document.getElementById('fa-date').value,
        asset_account_id: document.getElementById('fa-asset-acc').value,
        depreciation_expense_account_id: document.getElementById('fa-expense-acc').value
    };

    await postData('/assets/', payload);
    closeModal('asset-modal');
    e.target.reset();
    refreshData();
});

async function depreciateAsset(id) {
    const monthsInput = document.getElementById(`depr-months-${id}`);
    const months = parseInt(monthsInput.value) || 1;

    if (!confirm(`确认对该资产计提 ${months} 个月的折旧费用吗?`)) return;

    await postData(`/assets/${id}/depreciate`, { months: months });
    refreshData();
}

// Initial Load
refreshData();
