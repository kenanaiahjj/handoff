// The Playground's screens: "Penny", a made-up personal finance app in a shadcn/ui style.
// Each screen is HTML rendered once per version; `data-name` names a layer in the capture.
// Version 1.1 changes some screens so Review changes and Compare have something to show.

const paths = {
  home: '<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1Z"/>',
  activity: '<path d="M4 6h16M4 12h16M4 18h10"/>',
  chart: '<path d="M12 3v9l6.5 6.5A9 9 0 1 1 12 3Z"/><path d="M15 3.5A9 9 0 0 1 20.5 9H15Z"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>',
  send: '<path d="M7 17 17 7M8 7h9v9"/>',
  receive: '<path d="M17 7 7 17M16 17H7V8"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  bell: '<path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  chevron: '<path d="m9 18 6-6-6-6"/>',
  back: '<path d="m15 18-6-6 6-6"/>',
  coffee: '<path d="M17 8h1a4 4 0 1 1 0 8h-1"/><path d="M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4Z"/><path d="M6 2v2M10 2v2M14 2v2"/>',
  bag: '<path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><path d="M3 6h18M16 10a4 4 0 0 1-8 0"/>',
  car: '<path d="M5 17h14v-5l-2-5H7l-2 5Z"/><circle cx="7.5" cy="17.5" r="1.5"/><circle cx="16.5" cy="17.5" r="1.5"/>',
  wifi: '<path d="M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M2 9a15 15 0 0 1 20 0"/><circle cx="12" cy="19.5" r=".5"/>',
  card: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/>',
  moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
  globe: '<circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  sparkles: '<path d="m12 3 1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9Z"/><path d="M19 17v4M17 19h4"/>',
  trend: '<path d="m22 7-8.5 8.5-5-5L2 17"/><path d="M16 7h6v6"/>',
  mail: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 6L2 7"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
};

const icon = (name, { size = 20, stroke = "currentColor", width = 1.75, label } = {}) =>
  `<svg data-name="${label ?? `Icon / ${name}`}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${stroke}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round">${paths[name]}</svg>`;

const statusBar = (dark = false) => `
  <div class="status" data-name="Status bar"${dark ? ' style="color:#fff"' : ""}>
    <span class="status-time">9:41</span>
    <div class="status-icons" data-name="Indicators">
      <svg data-name="Signal" width="18" height="12" viewBox="0 0 18 12" fill="currentColor"><rect x="0" y="8" width="3" height="4" rx="1"/><rect x="5" y="5.5" width="3" height="6.5" rx="1"/><rect x="10" y="3" width="3" height="9" rx="1"/><rect x="15" y="0" width="3" height="12" rx="1"/></svg>
      <svg data-name="Wi-Fi" width="16" height="12" viewBox="0 0 16 12" fill="currentColor"><path d="M8 2.5c2.3 0 4.4.9 6 2.4l1.1-1.2A10.2 10.2 0 0 0 8 .8 10.2 10.2 0 0 0 .9 3.7L2 4.9a8.6 8.6 0 0 1 6-2.4Zm0 3.4c1.4 0 2.6.5 3.6 1.4l1.1-1.2A6.8 6.8 0 0 0 8 4.2a6.8 6.8 0 0 0-4.7 1.9l1.1 1.2c1-.9 2.2-1.4 3.6-1.4ZM8 9.2c-.6 0-1.1.2-1.5.6L8 11.4l1.5-1.6c-.4-.4-.9-.6-1.5-.6Z"/></svg>
      <svg data-name="Battery" width="27" height="13" viewBox="0 0 27 13" fill="none"><rect x=".5" y=".5" width="23" height="12" rx="3.5" stroke="currentColor" opacity=".35"/><rect x="2" y="2" width="20" height="9" rx="2" fill="currentColor"/><path d="M25 4.5v4c.8-.3 1.3-1.1 1.3-2s-.5-1.7-1.3-2Z" fill="currentColor" opacity=".4"/></svg>
    </div>
  </div>`;

const tabBar = (active, v11) => {
  // Layer names stay put when a tab is relabelled, so the change shows as an edit, not a swap.
  const items = [["Home", "home", "Home"], ["Activity", "activity", "Activity"], [v11 ? "Insights" : "Budgets", v11 ? "sparkles" : "chart", "Planning"], ["Settings", "settings", "Settings"]];
  return `
  <nav class="tabbar" data-name="Tab bar">
    ${items.map(([label, name, layer]) => `
      <div class="tabbar-item${label === active ? " tabbar-active" : ""}" data-name="Tab / ${layer}">
        ${icon(name, { size: 22, width: label === active ? 2 : 1.75, label: "Icon" })}
        <span>${label}</span>
      </div>`).join("")}
  </nav>
  <div class="home-indicator" data-name="Home indicator"></div>`;
};

const transactions = [
  { name: "Blue Bottle Coffee", meta: "Today · Food & drink", amount: "−$6.50", icon: "coffee", tint: "#fef3c7", color: "#b45309" },
  { name: "Salary · Northwind", meta: "Today · Income", amount: "+$4,250.00", icon: "receive", tint: "#dcfce7", color: "#15803d", positive: true },
  { name: "Uber", meta: "Yesterday · Transport", amount: "−$18.20", icon: "car", tint: "#e0e7ff", color: "#4338ca" },
  { name: "Everlane", meta: "Mon · Shopping", amount: "−$84.00", icon: "bag", tint: "#fce7f3", color: "#be185d" },
  { name: "Fiber Internet", meta: "Sun · Bills", amount: "−$59.99", icon: "wifi", tint: "#e0f2fe", color: "#0369a1" },
  { name: "Maya Santos", meta: "Sat · Transfer", amount: "+$40.00", icon: "receive", tint: "#dcfce7", color: "#15803d", positive: true },
  { name: "Trader Joe's", meta: "Fri · Groceries", amount: "−$72.35", icon: "bag", tint: "#fce7f3", color: "#be185d" },
  { name: "Lyft", meta: "Thu · Transport", amount: "−$11.80", icon: "car", tint: "#e0e7ff", color: "#4338ca" },
];

const txRow = (tx) => `
  <div class="list-row" data-name="Transaction / ${tx.name}">
    <div class="icon-tile" data-name="Category icon" style="background:${tx.tint};color:${tx.color}">${icon(tx.icon, { size: 18 })}</div>
    <div class="stack grow" data-name="Details" style="gap:2px">
      <span class="body medium">${tx.name}</span>
      <span class="xs muted">${tx.meta}</span>
    </div>
    <span class="body semibold tabular${tx.positive ? " pos" : ""}">${tx.amount}</span>
  </div>`;

const signIn = (v11) => `
  <div class="screen" data-name="Sign in">
    ${statusBar()}
    <div class="content" data-name="Content" style="padding:40px 24px 0;gap:32px">
      <div class="stack" data-name="Header" style="gap:20px">
        <div class="icon-tile" data-name="Logo" style="width:48px;height:48px;border-radius:12px;background:var(--primary);color:#fff">
          <svg data-name="Penny mark" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="8"/><path d="M12 8v8M9.5 10.5h4a1.5 1.5 0 0 1 0 3h-3a1.5 1.5 0 0 0 0 3h4"/></svg>
        </div>
        <div class="stack" data-name="Title" style="gap:8px">
          <h1 class="h1">Welcome back</h1>
          <p class="body muted">Sign in to see your balance, budgets and recent activity.</p>
        </div>
      </div>
      <div class="stack" data-name="Form" style="gap:16px">
        <div class="field" data-name="Field / Email">
          <label class="label">Email</label>
          <div class="input input-focus" data-name="Input">${icon("mail", { size: 16, stroke: "#71717a" })}<span>alex@penny.app</span></div>
        </div>
        <div class="field" data-name="Field / Password">
          <div class="between" data-name="Label row"><label class="label">Password</label><span class="small medium" style="color:var(--accent)">Forgot password?</span></div>
          <div class="input" data-name="Input">${icon("lock", { size: 16, stroke: "#71717a" })}<span class="muted">••••••••••</span></div>
        </div>
        <div class="btn btn-primary btn-lg" data-name="Button / Sign in" style="margin-top:8px">Sign in</div>
        <div class="row" data-name="Divider" style="gap:12px"><div class="separator grow"></div><span class="xs muted">OR CONTINUE WITH</span><div class="separator grow"></div></div>
        <div class="row" data-name="Social buttons" style="gap:12px">
          <div class="btn btn-outline btn-lg grow" data-name="Button / Apple"><svg data-name="Apple logo" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M16.4 12.6c0-2.5 2-3.7 2.1-3.8-1.2-1.7-3-1.9-3.6-2-1.5-.2-3 .9-3.8.9-.8 0-2-.9-3.3-.9-1.7 0-3.3 1-4.2 2.6-1.8 3.1-.5 7.7 1.3 10.2.8 1.2 1.8 2.6 3.1 2.6 1.3-.1 1.7-.8 3.3-.8 1.5 0 1.9.8 3.3.8 1.4 0 2.2-1.3 3-2.5.9-1.4 1.3-2.7 1.3-2.8 0 0-2.5-1-2.5-4.3ZM14 5.1c.7-.8 1.2-2 1-3.1-1 0-2.2.7-2.9 1.5-.6.7-1.2 1.9-1 3 1.1.1 2.2-.6 2.9-1.4Z"/></svg>Apple</div>
          <div class="btn btn-outline btn-lg grow" data-name="Button / Google"><svg data-name="Google logo" width="16" height="16" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.6 12.3c0-.8-.1-1.6-.2-2.3H12v4.3h6c-.3 1.4-1 2.6-2.2 3.4v2.8h3.5c2.1-1.9 3.3-4.8 3.3-8.2Z"/><path fill="#34A853" d="M12 23c3 0 5.5-1 7.3-2.7l-3.5-2.8c-1 .7-2.3 1.1-3.8 1.1-2.9 0-5.4-2-6.3-4.6H2.1v2.9C3.9 20.5 7.7 23 12 23Z"/><path fill="#FBBC05" d="M5.7 14c-.2-.7-.4-1.4-.4-2.1s.1-1.4.4-2.1V7H2.1C1.4 8.5 1 10.2 1 12s.4 3.5 1.1 5l3.6-3Z"/><path fill="#EA4335" d="M12 5.4c1.6 0 3.1.6 4.2 1.7l3.2-3.2C17.5 2.1 15 1 12 1 7.7 1 3.9 3.5 2.1 7l3.6 2.9C6.6 7.3 9.1 5.4 12 5.4Z"/></svg>Google</div>
        </div>
      </div>
      <p class="small muted" style="text-align:center;margin-top:auto;padding-bottom:48px">New to Penny? <span class="medium" style="color:var(--foreground)">Create an account</span></p>
    </div>
    <div class="home-indicator" data-name="Home indicator"></div>
  </div>`;

const home = (v11) => `
  <div class="screen muted-bg" data-name="Home">
    ${statusBar()}
    <div class="content" data-name="Content" style="gap:${v11 ? 24 : 20}px">
      <div class="between" data-name="Header">
        <div class="row" data-name="Greeting">
          <div class="avatar" data-name="Avatar" style="background:#e0e7ff;color:#4338ca">AR</div>
          <div class="stack" data-name="Text" style="gap:0">
            <span class="xs muted">Good morning</span>
            <span class="h3">Alex Rivera</span>
          </div>
        </div>
        <div class="btn btn-outline btn-icon" data-name="Button / Notifications">${icon("bell", { size: 18 })}</div>
      </div>
      <div class="card" data-name="Balance card" style="padding:20px;border:none;background:${v11 ? "var(--accent)" : "var(--primary)"};color:#fff;display:flex;flex-direction:column;gap:16px">
        <div class="between" data-name="Top row">
          <span class="small" style="opacity:.72">Total balance</span>
          <span class="badge" data-name="Badge / Trend" style="background:rgba(255,255,255,.14);color:#fff">${v11 ? "+4.2% this month" : "+2.1%"}</span>
        </div>
        <span class="tabular" data-name="Amount" style="font-size:36px;line-height:40px;font-weight:700;letter-spacing:-1px">$12,480.55</span>
        <div class="row" data-name="Actions" style="gap:10px">
          <div class="btn grow" data-name="Button / Send" style="background:#fff;color:var(--foreground)">${icon("send", { size: 16 })}Send</div>
          <div class="btn grow" data-name="Button / Request" style="background:rgba(255,255,255,.14);color:#fff">${icon("receive", { size: 16 })}${v11 ? "Request" : "Receive"}</div>
          <div class="btn btn-icon" data-name="Button / More" style="background:rgba(255,255,255,.14);color:#fff">${icon("plus", { size: 16 })}</div>
        </div>
      </div>
      ${v11 ? `
      <div class="card" data-name="Insight banner" style="padding:14px 16px;display:flex;align-items:center;gap:12px;background:var(--accent-soft);border-color:#c7d2fe">
        <div class="icon-tile" data-name="Icon" style="width:36px;height:36px;background:#fff;color:var(--accent)">${icon("sparkles", { size: 18 })}</div>
        <div class="stack grow" data-name="Text" style="gap:2px">
          <span class="small semibold">You spent 18% less on food</span>
          <span class="xs muted">Compared with last month</span>
        </div>
        ${icon("chevron", { size: 18, stroke: "#71717a" })}
      </div>` : ""}
      <div class="card" data-name="Recent activity" style="padding:4px 16px 4px">
        <div class="between" data-name="Section header" style="padding:12px 0 4px">
          <span class="h3">Recent activity</span>
          <span class="small medium muted">See all</span>
        </div>
        ${transactions.slice(0, v11 ? 4 : 5).map(txRow).join("")}
      </div>
    </div>
    ${tabBar("Home", v11)}
  </div>`;

const activity = (v11) => `
  <div class="screen" data-name="Activity">
    ${statusBar()}
    <div class="content" data-name="Content" style="gap:16px">
      <div class="between" data-name="Header">
        <h1 class="h1">Activity</h1>
        <div class="btn btn-outline btn-icon" data-name="Button / Export">${icon("activity", { size: 18 })}</div>
      </div>
      <div class="input" data-name="Search">${icon("search", { size: 16, stroke: "#71717a" })}<span class="muted">Search transactions</span></div>
      <div class="tabs" data-name="Tabs">
        <div class="tab tab-active" data-name="Tab / All">All</div>
        <div class="tab" data-name="Tab / Income">Income</div>
        <div class="tab" data-name="Tab / Spending">Spending</div>
      </div>
      <div class="stack" data-name="This week" style="gap:0">
        <span class="xs semibold muted" style="letter-spacing:.4px;padding-bottom:4px">THIS WEEK</span>
        ${transactions.map(txRow).join("")}
      </div>
    </div>
    ${tabBar("Activity", v11)}
  </div>`;

const sendMoney = (v11) => `
  <div class="screen" data-name="Send money">
    ${statusBar()}
    <div class="content" data-name="Content" style="gap:${v11 ? 28 : 24}px">
      <div class="between" data-name="Header">
        <div class="btn btn-outline btn-icon" data-name="Button / Back">${icon("back", { size: 18 })}</div>
        <span class="h3">Send money</span>
        <div style="width:40px"></div>
      </div>
      <div class="stack" data-name="Recipient" style="gap:10px">
        <span class="label">To</span>
        <div class="card" data-name="Recipient card" style="padding:12px;display:flex;align-items:center;gap:12px">
          <div class="avatar" data-name="Avatar" style="background:#fce7f3;color:#be185d">MS</div>
          <div class="stack grow" data-name="Text" style="gap:2px">
            <span class="body medium">Maya Santos</span>
            <span class="xs muted">@maya · Bank of Penny</span>
          </div>
          <span class="badge badge-secondary" data-name="Badge / Change">Change</span>
        </div>
      </div>
      <div class="stack" data-name="Amount" style="align-items:center;gap:6px;padding:12px 0">
        <span class="xs muted">Amount</span>
        <span class="tabular" data-name="Value" style="font-size:48px;line-height:52px;font-weight:700;letter-spacing:-1.5px">$120.00</span>
        <span class="badge badge-outline" data-name="Badge / Balance">Balance $12,480.55</span>
      </div>
      <div class="field" data-name="Field / Note">
        <label class="label">Note</label>
        <div class="input" data-name="Input"><span>Dinner at Kin Khao 🍜</span></div>
      </div>
      <div class="stack" data-name="Quick amounts" style="gap:10px">
        <span class="label">Quick amounts</span>
        <div class="row" data-name="Chips" style="gap:8px">
          ${["$20", "$50", "$120", "$200"].map((amount) => `<div class="btn ${amount === "$120" ? "btn-primary" : "btn-outline"} grow" data-name="Chip / ${amount}" style="height:36px">${amount}</div>`).join("")}
        </div>
      </div>
      <div class="stack" data-name="Footer" style="margin-top:auto;padding-bottom:42px;gap:10px">
        <div class="btn btn-primary btn-lg" data-name="Button / Continue">${v11 ? "Review transfer" : "Continue"}</div>
        <span class="xs muted" style="text-align:center">${v11 ? "Arrives instantly · No fee" : "Usually arrives within minutes"}</span>
      </div>
    </div>
    <div class="home-indicator" data-name="Home indicator"></div>
  </div>`;

const budgetRows = [
  { name: "Food & drink", spent: 412, limit: 600, color: "#f59e0b" },
  { name: "Transport", spent: 168, limit: 200, color: "#6366f1" },
  { name: "Shopping", spent: 284, limit: 250, color: "#ec4899", over: true },
  { name: "Bills", spent: 320, limit: 400, color: "#0ea5e9" },
];

const budgets = (v11) => `
  <div class="screen muted-bg" data-name="Budgets">
    ${statusBar()}
    <div class="content" data-name="Content">
      <div class="stack" data-name="Header" style="gap:4px">
        <h1 class="h1">Budgets</h1>
        <span class="body muted">November · 6 days left</span>
      </div>
      <div class="card card-pad" data-name="Summary card">
        <div class="between" data-name="Row"><span class="small muted">Spent this month</span><span class="badge badge-success">On track</span></div>
        <span class="h1 tabular" data-name="Amount">$1,184 <span class="body muted" style="font-weight:400;letter-spacing:0">of $1,450</span></span>
        <div class="progress" data-name="Progress"><div class="progress-bar" style="width:82%"></div></div>
      </div>
      <div class="card" data-name="Categories" style="padding:4px 16px">
        ${budgetRows.map((row) => `
        <div class="list-row" data-name="Budget / ${row.name}" style="flex-direction:column;align-items:stretch;gap:8px">
          <div class="between" data-name="Row">
            <span class="body medium">${row.name}</span>
            <span class="small tabular${row.over ? "" : " muted"}"${row.over ? ' style="color:var(--destructive)"' : ""}>$${row.spent} / $${row.limit}</span>
          </div>
          <div class="progress" data-name="Progress"><div class="progress-bar" style="width:${Math.min(100, Math.round((row.spent / row.limit) * 100))}%;background:${row.color}"></div></div>
        </div>`).join("")}
      </div>
      <div class="btn btn-outline" data-name="Button / New budget">${icon("plus", { size: 16 })}New budget</div>
    </div>
    ${tabBar("Budgets", v11)}
  </div>`;

const insights = (v11) => `
  <div class="screen muted-bg" data-name="Insights">
    ${statusBar()}
    <div class="content" data-name="Content">
      <div class="stack" data-name="Header" style="gap:4px">
        <h1 class="h1">Insights</h1>
        <span class="body muted">Your money in November</span>
      </div>
      <div class="tabs" data-name="Tabs">
        <div class="tab" data-name="Tab / Week">Week</div>
        <div class="tab tab-active" data-name="Tab / Month">Month</div>
        <div class="tab" data-name="Tab / Year">Year</div>
      </div>
      <div class="card card-pad" data-name="Spending chart">
        <div class="between" data-name="Row">
          <div class="stack" data-name="Total" style="gap:2px"><span class="small muted">Spending</span><span class="h2 tabular">$1,184.20</span></div>
          <span class="badge badge-success" data-name="Badge / Change">${icon("trend", { size: 12, width: 2.2 })}&nbsp;12% less</span>
        </div>
        <div class="row" data-name="Bars" style="align-items:flex-end;gap:10px;height:132px;padding-top:8px">
          ${[48, 72, 56, 96, 64, 118, 84].map((height, index) => `<div data-name="Bar ${index + 1}" style="flex:1;height:${height}px;border-radius:6px;background:${index === 5 ? "var(--accent)" : "#e4e4e7"}"></div>`).join("")}
        </div>
        <div class="between xs muted" data-name="Labels">${["M", "T", "W", "T", "F", "S", "S"].map((day) => `<span style="flex:1;text-align:center">${day}</span>`).join("")}</div>
      </div>
      <div class="card" data-name="Top categories" style="padding:4px 16px">
        <div class="between" data-name="Section header" style="padding:12px 0 4px"><span class="h3">Top categories</span><span class="small medium muted">Edit budgets</span></div>
        ${budgetRows.slice(0, 3).map((row) => `
        <div class="list-row" data-name="Category / ${row.name}">
          <div data-name="Swatch" style="width:10px;height:10px;border-radius:999px;background:${row.color};flex-shrink:0"></div>
          <span class="body medium grow">${row.name}</span>
          <span class="body semibold tabular">$${row.spent}</span>
        </div>`).join("")}
      </div>
    </div>
    ${tabBar("Insights", v11)}
  </div>`;

const settingRow = (iconName, label, detail, control) => `
  <div class="list-row" data-name="Setting / ${label}">
    <div class="icon-tile" data-name="Icon" style="width:32px;height:32px;border-radius:8px">${icon(iconName, { size: 16 })}</div>
    <div class="stack grow" data-name="Text" style="gap:1px"><span class="body medium">${label}</span>${detail ? `<span class="xs muted">${detail}</span>` : ""}</div>
    ${control}
  </div>`;
const toggle = (on) => `<div class="switch${on ? " switch-on" : ""}" data-name="Switch / ${on ? "On" : "Off"}"><div class="switch-thumb" data-name="Thumb"></div></div>`;
const chevron = icon("chevron", { size: 16, stroke: "#a1a1aa", label: "Chevron" });

const settings = (v11) => `
  <div class="screen muted-bg" data-name="Settings">
    ${statusBar()}
    <div class="content" data-name="Content" style="gap:16px">
      <h1 class="h1">Settings</h1>
      <div class="card" data-name="Profile card" style="padding:16px;display:flex;align-items:center;gap:12px">
        <div class="avatar" data-name="Avatar" style="width:48px;height:48px;font-size:16px;background:#e0e7ff;color:#4338ca">AR</div>
        <div class="stack grow" data-name="Text" style="gap:2px"><span class="h3">Alex Rivera</span><span class="small muted">alex@penny.app</span></div>
        <span class="badge badge-accent" data-name="Badge / Plan">Plus</span>
      </div>
      <div class="stack" data-name="Group / Preferences" style="gap:8px">
        <span class="xs semibold muted" style="letter-spacing:.4px;padding-left:4px">PREFERENCES</span>
        <div class="card" data-name="List" style="padding:0 16px">
          ${settingRow("bell", "Notifications", "Payments, budgets and tips", toggle(true))}
          ${settingRow("moon", "Dark mode", null, toggle(false))}
          ${v11 ? settingRow("sparkles", "Weekly insights", "A summary every Monday", toggle(true)) : ""}
          ${settingRow("globe", "Currency", "USD · US dollar", chevron)}
        </div>
      </div>
      <div class="stack" data-name="Group / Security" style="gap:8px">
        <span class="xs semibold muted" style="letter-spacing:.4px;padding-left:4px">SECURITY</span>
        <div class="card" data-name="List" style="padding:0 16px">
          ${settingRow("shield", "Face ID", "Required to send money", toggle(true))}
          ${settingRow("card", "Cards", "2 active", chevron)}
        </div>
      </div>
      <div class="btn btn-outline" data-name="Button / Sign out" style="color:var(--destructive)">${icon("logout", { size: 16 })}Sign out</div>
    </div>
    ${tabBar("Settings", v11)}
  </div>`;

const components = (v11) => `
  <div class="sheet${v11 ? " v11" : ""}" data-name="Components">
    <div class="stack" data-name="Header" style="gap:4px">
      <span class="h2">Penny UI</span>
      <span class="body muted">Buttons, inputs and badges used across the app.</span>
    </div>
    <div class="sheet-section" data-name="Buttons">
      <span class="eyebrow">Button</span>
      <div class="sheet-row" data-name="Variants">
        <div class="btn btn-primary" data-name="Button / Primary">Primary</div>
        <div class="btn btn-secondary" data-name="Button / Secondary">Secondary</div>
        <div class="btn btn-outline" data-name="Button / Outline">Outline</div>
        <div class="btn btn-ghost" data-name="Button / Ghost">Ghost</div>
        <div class="btn btn-destructive" data-name="Button / Destructive">Delete</div>
        ${v11 ? '<div class="btn btn-accent" data-name="Button / Accent">Accent</div>' : ""}
      </div>
      <div class="sheet-row" data-name="Sizes">
        <div class="btn btn-primary" data-name="Button / Small" style="height:32px;padding:0 12px;font-size:13px">Small</div>
        <div class="btn btn-primary" data-name="Button / Default">Default</div>
        <div class="btn btn-primary btn-lg" data-name="Button / Large">Large</div>
        <div class="btn btn-outline btn-icon" data-name="Button / Icon">${icon("plus", { size: 16 })}</div>
      </div>
    </div>
    <div class="sheet-section" data-name="Inputs">
      <span class="eyebrow">Input</span>
      <div class="sheet-row" data-name="States" style="align-items:flex-start">
        <div class="field" data-name="Input / Default" style="width:220px"><label class="label">Email</label><div class="input" data-name="Input"><span class="muted">you@example.com</span></div></div>
        <div class="field" data-name="Input / Focused" style="width:220px"><label class="label">Amount</label><div class="input input-focus" data-name="Input"><span>$120.00</span></div></div>
        <div class="field" data-name="Input / Error" style="width:220px"><label class="label">Card number</label><div class="input" data-name="Input" style="border-color:var(--destructive)"><span>4242 4242</span></div><span class="xs" style="color:var(--destructive)">Card number is too short.</span></div>
      </div>
    </div>
    <div class="sheet-section" data-name="Badges and controls">
      <span class="eyebrow">Badge · Switch · Tabs</span>
      <div class="sheet-row" data-name="Row">
        <span class="badge badge-secondary" data-name="Badge / Secondary">Secondary</span>
        <span class="badge badge-outline" data-name="Badge / Outline">Outline</span>
        <span class="badge badge-success" data-name="Badge / Success">Paid</span>
        <span class="badge badge-accent" data-name="Badge / Accent">Plus</span>
        <span class="badge badge-destructive" data-name="Badge / Destructive">Over budget</span>
        ${toggle(true)}
        ${toggle(false)}
        <div class="tabs" data-name="Tabs" style="width:220px"><div class="tab tab-active">Month</div><div class="tab">Year</div></div>
      </div>
    </div>
  </div>`;

/** Screen ids stay the same across versions so Compare and Review changes can match them. */
export const screens = [
  { id: "penny-sign-in", name: "Sign in", render: signIn, width: 390, height: 844 },
  { id: "penny-home", name: "Home", render: home, width: 390, height: 844 },
  { id: "penny-activity", name: "Activity", render: activity, width: 390, height: 844 },
  { id: "penny-send-money", name: "Send money", render: sendMoney, width: 390, height: 844 },
  { id: "penny-budgets", name: "Budgets", render: budgets, width: 390, height: 844, versions: ["1.0"] },
  { id: "penny-insights", name: "Insights", render: insights, width: 390, height: 844, versions: ["1.1"] },
  { id: "penny-settings", name: "Settings", render: settings, width: 390, height: 844 },
  { id: "penny-components", name: "Components", render: components, width: 760, height: 600 },
];

export const versions = [
  {
    label: "1.0",
    capturedAt: "2026-11-10T09:30:00.000Z",
    note: "First pass at Penny: sign in, home, activity, sending money, budgets and settings.",
  },
  {
    label: "1.1",
    capturedAt: "2026-11-21T14:05:00.000Z",
    note: "Budgets became Insights. Home gets the indigo balance card and an insight banner, Send money says \"Review transfer\", Settings adds Weekly insights, and the Components sheet adds an Accent button with rounder corners.",
  },
];

/**
 * Sample review comments on the latest version, pinned to a layer by name. `x`/`y` are offsets from
 * that layer's top-left corner. Authors are labels only (no accounts behind them).
 */
export const comments = [
  {
    frame: "penny-home", layer: "Insight banner", x: 300, y: 18, author: "Maya Santos", role: "pd", hoursAgo: 20,
    body: "Love this. Can the banner be dismissed? People will see it every time they open the app.",
    replies: [{ author: "Jordan Lee", role: "dev", hoursAgo: 18, body: "Adding a close button and remembering it for 7 days. Does that work?" }],
  },
  {
    frame: "penny-send-money", layer: "Button / Continue", x: 250, y: 10, author: "Jordan Lee", role: "dev", hoursAgo: 16,
    body: "Is \"Review transfer\" the final copy? The API returns a fee for international transfers, so \"No fee\" isn't always true.",
  },
  {
    frame: "penny-settings", layer: "Setting / Weekly insights", x: 24, y: 20, author: "Priya Nair", role: "qa", hoursAgo: 9,
    body: "Toggle state isn't saved after relaunching the app on Android 14.",
  },
  {
    frame: "penny-activity", layer: "Search", x: 320, y: 12, author: "Maya Santos", role: "pd", hoursAgo: 30, resolved: true,
    body: "Search placeholder should mention merchants too.",
    replies: [{ author: "Alex Kim", role: "pd", hoursAgo: 28, body: "Done in this version: \"Search transactions\" covers it, kept it short." }],
  },
];
