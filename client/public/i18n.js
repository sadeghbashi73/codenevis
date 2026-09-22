/* Persian and English strings for the control panel. */

const fa = {
  dir: 'rtl',
  name: 'فارسی',

  'nav.overview': 'نمای کلی',
  'nav.projects': 'پروژه‌ها',
  'nav.board': 'برد',
  'nav.tasks': 'تسک‌ها',
  'nav.activity': 'فعالیت',
  'nav.runs': 'اجراها',
  'nav.agents': 'ایجنت‌ها',
  'nav.settings': 'تنظیمات',
  'nav.section.work': 'کار',
  'nav.section.system': 'سیستم',

  'action.newProject': 'پروژه‌ی جدید',
  'action.continue': 'ادامه‌ی بک‌لاگ',
  'action.refresh': 'تازه‌سازی',
  'action.save': 'ذخیره',
  'action.cancel': 'انصراف',
  'action.create': 'بساز',
  'action.github': 'باز کردن در گیت‌هاب',
  'action.retry': 'اجرای دوباره‌ی دولوپر',
  'action.review': 'ریویو دوباره',
  'action.unblock': 'رفع انسداد',
  'action.viewAll': 'دیدن همه',
  'action.back': 'بازگشت',
  'action.saving': 'در حال ذخیره…',

  'status.todo': 'در انتظار',
  'status.in-progress': 'در حال ساخت',
  'status.review': 'در ریویو',
  'status.changes-requested': 'نیاز به اصلاح',
  'status.done': 'تمام',
  'status.blocked': 'نیاز به تو',
  'status.merged': 'مرج شد',
  'status.open': 'باز',
  'status.closed': 'بسته',

  'role.po': 'مدیر محصول',
  'role.dev': 'دولوپر',
  'role.qc': 'کنترل کیفیت',
  'role.pipeline': 'پایپ‌لاین',
  'role.human': 'تو',
  'role.bot': 'ربات',
  'role.shared': 'کلید مشترک',
  'role.github': 'توکن گیت‌هاب',

  'role.po.blurb': 'خواسته‌ات را به PRD و بک‌لاگ تبدیل می‌کند',
  'role.dev.blurb': 'هر تسک را روی برنچ جدا پیاده‌سازی می‌کند',
  'role.qc.blurb': 'PR را ریویو می‌کند و مرج می‌کند یا برمی‌گرداند',
  'role.shared.blurb': 'فقط جایی استفاده می‌شود که کلید اختصاصی نباشد',
  'role.github.blurb': 'اختیاری — به QC اجازه‌ی تأیید واقعی می‌دهد',

  'overview.title': 'نمای کلی',
  'overview.subtitle': 'وضعیت تیم در یک نگاه',
  'overview.running': 'پایپ‌لاین در حال اجراست',
  'overview.idle': 'پایپ‌لاین بی‌کار است',
  'overview.progress': 'پیشرفت',
  'overview.merged': 'تسک مرج‌شده',
  'overview.agents': 'ایجنت‌ها',
  'overview.recent': 'فعالیت اخیر',
  'overview.runs': 'اجراهای اخیر',
  'overview.nothing': 'هنوز چیزی ساخته نشده',
  'overview.start': 'یک پروژه تعریف کن تا مدیر محصول شروع کند به برنامه‌ریزی.',
  'overview.needsKeys': 'هنوز کلید API ثبت نشده. بدون کلید هیچ ایجنتی اجرا نمی‌شود.',
  'overview.setKeys': 'ثبت کلیدها',
  'overview.working': 'مشغول تسک #{n}',
  'overview.waiting': 'منتظر کار',
  'overview.noKey': 'کلید ثبت نشده',

  'projects.title': 'پروژه‌ها',
  'projects.subtitle': 'هر پروژه یک issue است که مدیر محصول برنامه‌ریزی‌اش می‌کند',
  'projects.planned': 'برنامه‌ریزی شد',
  'projects.new': 'برنامه‌ریزی نشده',
  'projects.empty': 'هنوز پروژه‌ای نیست.',
  'projects.tasks': '{n} تسک',
  'project.brief': 'شرح خواسته',
  'project.prd': 'سند محصول (PRD)',
  'project.tasksTitle': 'تسک‌های این پروژه',
  'project.noPrd': 'هنوز PRD نوشته نشده.',

  'board.title': 'برد',
  'board.subtitle': 'تسک‌ها بر اساس وضعیت',
  'board.empty': 'ستون خالی',

  'tasks.title': 'تسک‌ها',
  'tasks.subtitle': 'بک‌لاگ به ترتیب اجرا',
  'tasks.all': 'همه',
  'tasks.search': 'جستجو در تسک‌ها…',
  'tasks.empty': 'تسکی با این فیلتر نیست.',
  'tasks.none': 'هنوز تسکی نیست. یک پروژه بساز تا مدیر محصول بک‌لاگ را پر کند.',

  'task.criteria': 'معیارهای پذیرش',
  'task.description': 'شرح',
  'task.conversation': 'گفتگو',
  'task.pr': 'پول‌ریکوئست',
  'task.files': 'فایل‌ها',
  'task.noComments': 'هنوز کامنتی نیست.',
  'task.comments': '{n} کامنت',

  'activity.title': 'فعالیت',
  'activity.subtitle': 'هر کامنتی که در ریپو گذاشته شده، از تازه به قدیم',
  'activity.empty': 'هنوز حرفی زده نشده.',
  'activity.on': 'روی',

  'runs.title': 'اجراها',
  'runs.subtitle': 'اجراهای اخیر GitHub Actions',
  'runs.empty': 'هنوز اجرایی نبوده.',

  'agents.title': 'ایجنت‌ها',
  'agents.subtitle': 'مدل، provider و کلید API هر نقش',
  'agents.key': 'کلید API',
  'agents.keySet': 'ثبت شده {when}',
  'agents.keyUnset': 'ثبت نشده',
  'agents.keyPlaceholderSet': '•••••••••• — برای جایگزینی مقدار جدید بزن',
  'agents.keyPlaceholder': 'کلید {name} را اینجا بگذار',
  'agents.model': 'مدل',
  'agents.provider': 'ارائه‌دهنده',
  'agents.steps': 'سقف گام',
  'agents.temperature': 'دما',
  'agents.saveModels': 'ذخیره‌ی مدل‌ها',
  'agents.note': 'تغییر مدل‌ها در config/agents.json نوشته می‌شود. برای اینکه به Actions برسد commit و push کن.',
  'agents.keyNote': 'کلیدها با GitHub CLI رمزنگاری می‌شوند و مستقیم در secrets ریپو می‌نشینند. این پنل فقط می‌داند کلید ثبت شده یا نه، نه محتوایش را.',
  'agents.noGh': 'GitHub CLI نصب نیست، پس ثبت کلید از اینجا ممکن نیست — مقدار باید پیش از ارسال با کلید عمومی ریپو رمز شود. از cli.github.com نصبش کن یا کلیدها را در تنظیمات ریپو بگذار.',
  'agents.extra': 'کلیدهای دیگر',

  'settings.title': 'تنظیمات',
  'settings.subtitle': 'اتصال و سیاست‌های پایپ‌لاین',
  'settings.connection': 'اتصال',
  'settings.repo': 'ریپازیتوری',
  'settings.token': 'توکن گیت‌هاب',
  'settings.tokenHint': 'خالی بگذار تا از gh auth token استفاده شود',
  'settings.saved': 'در .codenevis/local.json ذخیره شد',
  'settings.policy': 'سیاست‌ها',
  'settings.qcRounds': 'تعداد راند ریویو پیش از ارجاع به تو',
  'settings.tasksPerRun': 'تعداد تسک در هر اجرای پایپ‌لاین',
  'settings.autoMerge': 'مرج خودکار پس از تأیید QC',
  'settings.language': 'زبان',
  'settings.docs': 'مستندات',

  'dialog.newProject': 'پروژه‌ی جدید',
  'dialog.newProjectHint': 'خواسته‌ات را ساده بنویس. مدیر محصول آن را به PRD و بک‌لاگ تبدیل می‌کند، بعد دولوپر و QC تسک‌به‌تسک می‌سازندش.',
  'dialog.title': 'عنوان',
  'dialog.body': 'چه چیزی می‌خواهی ساخته شود؟',
  'dialog.startNow': 'همین حالا پایپ‌لاین را شروع کن',
  'dialog.titlePlaceholder': 'یک ابزار خط فرمان برای ثبت زمان',
  'dialog.bodyPlaceholder': 'تایمر را برای یک پروژه‌ی نام‌دار شروع و متوقف کن.\nمجموع زمان هر پروژه در هفته‌ی جاری را نشان بده.\nداده‌ها بعد از ری‌استارت بمانند.\n\nمحدودیت‌ها: پایتون، بدون سرویس بیرونی.',

  'toast.keySaved': '{name} ذخیره شد',
  'toast.emptyField': 'فیلد خالی است',
  'toast.modelsSaved': 'در config/agents.json ذخیره شد',
  'toast.pipelineStarted': 'پایپ‌لاین شروع شد — تسک بعدی را برمی‌دارد',
  'toast.projectCreated': 'پروژه‌ی #{n} ساخته شد',
  'toast.projectPlanning': 'پروژه‌ی #{n} ساخته شد — مدیر محصول دارد برنامه‌ریزی می‌کند',
  'toast.connSaved': 'اتصال ذخیره شد',
  'toast.noToken': 'توکن گیت‌هاب پیدا نشد. در تنظیمات ثبتش کن یا gh auth login بزن.',
  'toast.dispatched': 'اجرا شروع شد',
  'toast.unblocked': 'تسک آزاد شد',

  'time.now': 'همین الان',
  'time.m': 'دقیقه پیش',
  'time.h': 'ساعت پیش',
  'time.d': 'روز پیش',
  'time.w': 'هفته پیش',
  loading: 'در حال بارگذاری…',
};

const en = {
  dir: 'ltr',
  name: 'English',

  'nav.overview': 'Overview',
  'nav.projects': 'Projects',
  'nav.board': 'Board',
  'nav.tasks': 'Tasks',
  'nav.activity': 'Activity',
  'nav.runs': 'Runs',
  'nav.agents': 'Agents',
  'nav.settings': 'Settings',
  'nav.section.work': 'Work',
  'nav.section.system': 'System',

  'action.newProject': 'New project',
  'action.continue': 'Continue backlog',
  'action.refresh': 'Refresh',
  'action.save': 'Save',
  'action.cancel': 'Cancel',
  'action.create': 'Create',
  'action.github': 'Open on GitHub',
  'action.retry': 'Run the developer again',
  'action.review': 'Review again',
  'action.unblock': 'Unblock',
  'action.viewAll': 'View all',
  'action.back': 'Back',
  'action.saving': 'Saving…',

  'status.todo': 'Waiting',
  'status.in-progress': 'Building',
  'status.review': 'In review',
  'status.changes-requested': 'Changes asked',
  'status.done': 'Done',
  'status.blocked': 'Needs you',
  'status.merged': 'Merged',
  'status.open': 'Open',
  'status.closed': 'Closed',

  'role.po': 'Product Owner',
  'role.dev': 'Developer',
  'role.qc': 'QC',
  'role.pipeline': 'Pipeline',
  'role.human': 'You',
  'role.bot': 'Bot',
  'role.shared': 'Shared key',
  'role.github': 'GitHub token',

  'role.po.blurb': 'Turns your brief into a PRD and a backlog',
  'role.dev.blurb': 'Implements each task on its own branch',
  'role.qc.blurb': 'Reviews the pull request, then merges or sends it back',
  'role.shared.blurb': 'Used only where a dedicated key is missing',
  'role.github.blurb': 'Optional — lets QC post a real approval',

  'overview.title': 'Overview',
  'overview.subtitle': 'The state of the team at a glance',
  'overview.running': 'Pipeline is running',
  'overview.idle': 'Pipeline is idle',
  'overview.progress': 'Progress',
  'overview.merged': 'tasks merged',
  'overview.agents': 'Agents',
  'overview.recent': 'Recent activity',
  'overview.runs': 'Recent runs',
  'overview.nothing': 'Nothing built yet',
  'overview.start': 'Describe a project and the Product Owner will start planning it.',
  'overview.needsKeys': 'No API keys yet. Without them no agent can run.',
  'overview.setKeys': 'Set the keys',
  'overview.working': 'On task #{n}',
  'overview.waiting': 'Waiting for work',
  'overview.noKey': 'No key set',

  'projects.title': 'Projects',
  'projects.subtitle': 'Each project is an issue the Product Owner plans',
  'projects.planned': 'Planned',
  'projects.new': 'Not planned',
  'projects.empty': 'No projects yet.',
  'projects.tasks': '{n} tasks',
  'project.brief': 'The brief',
  'project.prd': 'Product definition',
  'project.tasksTitle': 'Tasks in this project',
  'project.noPrd': 'No PRD has been written yet.',

  'board.title': 'Board',
  'board.subtitle': 'Tasks by status',
  'board.empty': 'Empty',

  'tasks.title': 'Tasks',
  'tasks.subtitle': 'The backlog in execution order',
  'tasks.all': 'All',
  'tasks.search': 'Search tasks…',
  'tasks.empty': 'No task matches this filter.',
  'tasks.none': 'No tasks yet. Create a project and the Product Owner will fill the backlog.',

  'task.criteria': 'Acceptance criteria',
  'task.description': 'Description',
  'task.conversation': 'Conversation',
  'task.pr': 'Pull request',
  'task.files': 'Files',
  'task.noComments': 'No comments yet.',
  'task.comments': '{n} comments',

  'activity.title': 'Activity',
  'activity.subtitle': 'Every comment in the repository, newest first',
  'activity.empty': 'Nothing has been said yet.',
  'activity.on': 'on',

  'runs.title': 'Runs',
  'runs.subtitle': 'Recent GitHub Actions runs',
  'runs.empty': 'No runs yet.',

  'agents.title': 'Agents',
  'agents.subtitle': 'The model, provider and API key for each role',
  'agents.key': 'API key',
  'agents.keySet': 'set {when}',
  'agents.keyUnset': 'not set',
  'agents.keyPlaceholderSet': '•••••••••• — type a new value to replace',
  'agents.keyPlaceholder': 'paste the key for {name}',
  'agents.model': 'Model',
  'agents.provider': 'Provider',
  'agents.steps': 'Step budget',
  'agents.temperature': 'Temperature',
  'agents.saveModels': 'Save models',
  'agents.note': 'Model changes are written to config/agents.json. Commit and push for them to reach Actions.',
  'agents.keyNote': 'Keys are encrypted by the GitHub CLI and written straight into repository secrets. This panel knows whether a key is set, never what it is.',
  'agents.noGh': 'The GitHub CLI is not installed, so keys cannot be set here — the value has to be encrypted with the repository public key before it is sent. Install it from cli.github.com, or set the secrets in the repository settings.',
  'agents.extra': 'Other keys',

  'settings.title': 'Settings',
  'settings.subtitle': 'Connection and pipeline policy',
  'settings.connection': 'Connection',
  'settings.repo': 'Repository',
  'settings.token': 'GitHub token',
  'settings.tokenHint': 'Leave empty to keep using gh auth token',
  'settings.saved': 'Saved to .codenevis/local.json',
  'settings.policy': 'Policy',
  'settings.qcRounds': 'Review rounds before a task is escalated to you',
  'settings.tasksPerRun': 'Tasks attempted per pipeline run',
  'settings.autoMerge': 'Merge automatically once QC approves',
  'settings.language': 'Language',
  'settings.docs': 'Documentation',

  'dialog.newProject': 'New project',
  'dialog.newProjectHint': 'Describe what you want in plain language. The Product Owner turns it into a PRD and a backlog, then the developer and QC build it task by task.',
  'dialog.title': 'Title',
  'dialog.body': 'What do you want built?',
  'dialog.startNow': 'Start the pipeline immediately',
  'dialog.titlePlaceholder': 'A CLI time tracker',
  'dialog.bodyPlaceholder': 'Start and stop a timer for a named project.\nShow total time per project for the current week.\nData survives a restart.\n\nConstraints: Python, no external services.',

  'toast.keySaved': '{name} saved',
  'toast.emptyField': 'The field is empty',
  'toast.modelsSaved': 'Saved to config/agents.json',
  'toast.pipelineStarted': 'Pipeline started — it will pick up the next task',
  'toast.projectCreated': 'Project #{n} created',
  'toast.projectPlanning': 'Project #{n} created — the Product Owner is planning it',
  'toast.connSaved': 'Connection saved',
  'toast.noToken': 'No GitHub token found. Set one in Settings, or run gh auth login.',
  'toast.dispatched': 'Run started',
  'toast.unblocked': 'Task unblocked',

  'time.now': 'just now',
  'time.m': 'm ago',
  'time.h': 'h ago',
  'time.d': 'd ago',
  'time.w': 'w ago',
  loading: 'Loading…',
};

const DICTS = { fa, en };

export let lang = localStorage.getItem('codenevis.lang') ?? 'fa';

export function setLang(next) {
  lang = DICTS[next] ? next : 'fa';
  localStorage.setItem('codenevis.lang', lang);
  document.documentElement.lang = lang;
  document.documentElement.dir = DICTS[lang].dir;
}

export function t(key, vars) {
  let s = DICTS[lang][key] ?? DICTS.en[key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, v);
  return s;
}

export const languages = Object.entries(DICTS).map(([code, d]) => ({ code, name: d.name }));

/** Relative time, in the active language. */
export function ago(iso) {
  const seconds = Math.floor((Date.now() - new Date(iso)) / 1000);
  if (seconds < 60) return t('time.now');
  let value = Math.floor(seconds / 60);
  let unit = 'm';
  for (const [next, factor] of [['h', 60], ['d', 24], ['w', 7]]) {
    if (value < factor) break;
    value = Math.floor(value / factor);
    unit = next;
  }
  const suffix = t(`time.${unit}`);
  return lang === 'fa' ? `${value} ${suffix}` : `${value}${suffix}`;
}
