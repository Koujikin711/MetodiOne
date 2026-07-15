export type StudioCaseMetric = {
  value: string;
  label: { en: string; ru: string };
};

export type StudioCase = {
  id: string;
  title: { en: string; ru: string };
  industry: { en: string; ru: string };
  context: { en: string; ru: string };
  problem: { en: string; ru: string };
  did: { en: string; ru: string };
  result: { en: string; ru: string };
  metrics: StudioCaseMetric[];
  productIds: string[];
};

/** Anonymized delivery stories — problem → build → business impact. */
export const STUDIO_CASES: StudioCase[] = [
  {
    id: "crm-service",
    title: {
      en: "From personal WhatsApp to a shared service desk",
      ru: "От личных WhatsApp к общему сервисному столу",
    },
    industry: {
      en: "Multi-location service business",
      ru: "Сервисный бизнес с несколькими точками",
    },
    context: {
      en: "Growing chain: several sites, shared call center, owners reviewing weekly KPIs remotely.",
      ru: "Растущая сеть: несколько точек, общий кол-центр, владельцы смотрят KPI удалённо раз в неделю.",
    },
    problem: {
      en: "Inbound requests landed in managers’ personal WhatsApp. Booking lived in a shared Google Sheet that lagged reality. Each site ran its own “funnel” in chat labels. When a manager left, half the conversation history left with the phone. Owners asked for conversion and got screenshots of chats plus an Excel export someone assembled the night before.",
      ru: "Заявки падали в личные WhatsApp менеджеров. Запись жила в общей Google Sheet и отставала от факта. Каждая точка вела свою «воронку» ярлыками в чатах. Увольнение менеджера уносило половину истории вместе с телефоном. Владельцы просили конверсию — получали скриншоты чатов и Excel, который кто-то собирал ночью накануне.",
    },
    did: {
      en: "Delivered MetodiOne CRM as a multi-tenant product: common pipeline stages per service line, omnichannel chat into one desk, online booking tied to the same customer card, roles for site vs HQ, and live analytics the owners could open without asking the team. Piloted on one location, then rolled the same model to the rest.",
      ru: "Поставили MetodiOne CRM как мультитенант-продукт: общие стадии воронки по линейкам услуг, омниканал-чат в одном столе, онлайн-запись на той же карточке клиента, роли «точка / головной офис» и живая аналитика без запроса к команде. Пилот на одной точке — затем тот же контур на остальные.",
    },
    result: {
      en: "Leads stopped vanishing into private phones. Booking and pipeline finally described the same customer. Shift handovers became a status change, not a voice note. Owners check a live desk instead of chasing “the table”. The business gained a repeatable sales process they can train new staff on in days, not weeks of shadowing chats.",
      ru: "Заявки перестали пропадать в личных телефонах. Запись и воронка описывают одного клиента. Передача смены — смена статуса, а не голосовое. Владельцы смотрят живое рабочее место, а не гоняются за «таблицей». Появился повторяемый процесс продаж: нового сотрудника учат днями, а не неделями «тени» в чужих чатах.",
    },
    metrics: [
      {
        value: "0",
        label: {
          en: "leads stuck only on personal phones",
          ru: "лидов только на личных телефонах",
        },
      },
      {
        value: "1",
        label: {
          en: "shared funnel across all sites",
          ru: "общая воронка на все точки",
        },
      },
      {
        value: "same day",
        label: {
          en: "team working in the product after go-live",
          ru: "команда в продукте в день запуска",
        },
      },
    ],
    productIds: ["metodione-crm"],
  },
  {
    id: "fuel-wholesale",
    title: {
      en: "Month-end that used to take days now closes in hours",
      ru: "Закрытие месяца: дни превратились в часы",
    },
    industry: {
      en: "Wholesale fuel distribution",
      ru: "Оптовая дистрибуция топлива",
    },
    context: {
      en: "Regional trader: purchases and sales in multiple currencies, bank statements, tank movements, thin back-office team.",
      ru: "Региональный трейдер: закупки и продажи в нескольких валютах, банк, движения по резервуарам, тонкий бэк-офис.",
    },
    problem: {
      en: "Purchases, sales and bank confirmations lived in Excel plus messenger screenshots of “done deals”. Multi-currency contracts drifted from tank reality: finance closed numbers that ops had never posted the same way. Month-end became a reconciliation war — three days of re-keying, still with disputed balances. Auditors and partners asked for a journal; the answer was five files and a phone call.",
      ru: "Поступления, реализации и банк жили в Excel и скриншотах «сделок» из мессенджеров. Мультивалютные контракты расходились с фактом по резервуарам: финансы закрывали цифры, которые операции проводили иначе. Закрытие месяца — война сверки: три дня перебивки, и всё равно спорные остатки. Аудиторы и партнёры просили журнал — в ответ пять файлов и звонок.",
    },
    did: {
      en: "Built FuelOps: a single document contour for purchases, sales and bank, operational journals, multi-currency print forms, tank-aware posting and role-based access. Replaced the five-table ritual with one desk where ops posts the same day and finance reviews the same journal. Sandbox kept for stakeholder demos without touching production.",
      ru: "Собрали FuelOps: единый контур документов (поступления / реализации / банк), операционные журналы, мультивалютные печатные формы, проведение с учётом резервуаров и доступ по ролям. Пять таблиц заменили одним столом: операции проводят в день сделки, финансы смотрят тот же журнал. Для заинтересованных сторон — песочница без доступа к боевым данным.",
    },
    result: {
      en: "Deal → posted document shrunk from days to hours. Finance stopped rebuilding the month from chats. Tank and money stories finally reconcile in one system, so management decisions rest on posted truth, not optimism in Excel. Board and partner reviews reopen the live product instead of a rebuilt slide deck.",
      ru: "Путь «сделка → проведённый документ» сжался с дней до часов. Финансы перестали собирать месяц из чатов. Резервуары и деньги сходятся в одной системе — решения руководства опираются на проведённую правду, а не на оптимизм в Excel. Совет и партнёры открывают живой продукт, а не заново собранную презентацию.",
    },
    metrics: [
      {
        value: "3d → hours",
        label: {
          en: "month-end close cycle",
          ru: "цикл закрытия месяца",
        },
      },
      {
        value: "1 journal",
        label: {
          en: "instead of five reconciling files",
          ru: "вместо пяти файлов сверки",
        },
      },
      {
        value: "same day",
        label: {
          en: "ops posting after a deal",
          ru: "проведение сделки операциями",
        },
      },
    ],
    productIds: ["fuelops"],
  },
  {
    id: "wechat-operator",
    title: {
      en: "International sales no longer tied to one phone",
      ru: "Международные продажи больше не живут на одном телефоне",
    },
    industry: {
      en: "Cross-border messenger sales desk",
      ru: "Международный стол продаж в мессенджерах",
    },
    context: {
      en: "Export / import sales: WeChat and WhatsApp as primary channels, operators in shifts, counterparties across borders.",
      ru: "Экспорт / импорт: WeChat и WhatsApp как основные каналы, операторы по сменам, контрагенты за рубежом.",
    },
    problem: {
      en: "Traffic hit personal phones. Counterparties were renamed ad hoc in chats; nobody shared a clean account card. Bridge installs crashed on client machines and only “the guy who knows” could revive them. When an operator left or went on leave, the next person inherited mute threads and lost context — deals stalled while people scrolled old screenshots.",
      ru: "Трафик шёл на личные телефоны. Контрагентов переименовывали ad hoc в чатах — общей карточки не было. Мосты падали на машинах клиентов, и поднимал их только «тот, кто знает». Уход или отпуск оператора оставлял немым треды и потерянный контекст — сделки замирали, пока кто-то листал старые скриншоты.",
    },
    did: {
      en: "Built MessageHub: a shared operator desk, counterparties as first-class records, inbound webhooks, and an installable bridge path with a repeatable setup — so messenger work lives in a product, not on a private device. Training materials and a sandbox for the next hire.",
      ru: "Собрали MessageHub: общий стол оператора, контрагенты как полноценные карточки, входящие вебхуки и устанавливаемый мост с повторяемой установкой — работа в мессенджерах в продукте, а не на личном устройстве. Обучение и песочница для следующего сотрудника.",
    },
    result: {
      en: "Shift handovers became possible without copying chats. Leads stay attached to accounts managers and partners can audit. Bridge recovery is a procedure, not tribal knowledge. Sales continuity no longer depends on one SIM card — the desk survives people turnover.",
      ru: "Передача смены возможна без копирования чатов. Лиды привязаны к карточкам, которые можно передать и проверить. Восстановление моста — процедура, а не сакральное знание. Непрерывность продаж не зависит от одной SIM: стол переживает смену людей.",
    },
    metrics: [
      {
        value: "shift-ready",
        label: {
          en: "handover without private phones",
          ru: "передача смены без личных телефонов",
        },
      },
      {
        value: "playbook",
        label: {
          en: "bridge install instead of tribal fix",
          ru: "установка моста вместо «позвони эксперту»",
        },
      },
      {
        value: "account-tied",
        label: {
          en: "leads stay with the counterparty",
          ru: "лиды остаются на карточке контрагента",
        },
      },
    ],
    productIds: ["messagehub"],
  },
  {
    id: "weighbridge-whatsapp",
    title: {
      en: "Weighbridge totals the whole team can trust",
      ru: "Итоги весовой, которым верит вся смена",
    },
    industry: {
      en: "Logistics / industrial weighbridge",
      ru: "Логистика / промышленная весовая",
    },
    context: {
      en: "Site with heavy truck flow: drivers, dispatchers, nightly tonnage reporting to management.",
      ru: "Площадка с плотным потоком грузовиков: водители, диспетчеры, ночной отчёт по тоннажу для руководства.",
    },
    problem: {
      en: "Drivers photographed the scale board into a WhatsApp group. Dispatchers retyped weights by hand — typos and “approximate” nets were normal. Gross vs tare was argued verbally; daily totals were rebuilt at night in Excel from chat history. Drivers and clients disputed the same trip with different numbers. Management never trusted the day’s tonnes.",
      ru: "Водители слали фото табло в WhatsApp-группу. Диспетчеры перебивали вес вручную — опечатки и «примерное» нетто были нормой. Брутто и тара спорили голосом; дневной итог собирали ночью в Excel из истории чата. Водители и клиенты спорили по одной поездке разными цифрами. Руководство не верило тоннажу дня.",
    },
    did: {
      en: "Built ScaleGate around the habit they already had: photo + caption in the group. OCR reads gross; net = current − previous for the linked truck; the bot posts a confirmed report back to the chat; a web panel keeps history, search and roles for dispatch and admins. No new device on the scale — the process stayed in WhatsApp.",
      ru: "Собрали ScaleGate вокруг привычки, которая уже была: фото + подпись в группе. OCR читает брутто; нетто = текущий − предыдущий для связанной машины; бот публикует подтверждённый отчёт в чат; веб-панель хранит историю, поиск и роли. Нового железа на весах нет — процесс остался в WhatsApp.",
    },
    result: {
      en: "Every weighing leaves an auditable trail in minutes. The group sees the same numbers the panel stores — disputes drop because there is one source of truth. Nightly “rebuild the day in Excel” disappeared; management opens the panel for the total. Drivers get a clear confirmation instead of a vague “ok” in chat.",
      ru: "Каждое взвешивание оставляет аудируемый след за минуты. Группа видит те же цифры, что панель — споры падают, потому что источник один. Ночной «сбор дня» в Excel исчез; руководство открывает панель за итогом. Водитель получает ясное подтверждение вместо смутного «ок» в чате.",
    },
    metrics: [
      {
        value: "minutes",
        label: {
          en: "from photo to confirmed report",
          ru: "от фото до подтверждённого отчёта",
        },
      },
      {
        value: "1 truth",
        label: {
          en: "group chat and web panel match",
          ru: "чат группы и веб-панель совпадают",
        },
      },
      {
        value: "no night Excel",
        label: {
          en: "daily tonnage rebuild dropped",
          ru: "ночной сбор тоннажа ушёл",
        },
      },
    ],
    productIds: ["scalegate"],
  },
  {
    id: "furniture-factory",
    title: {
      en: "Factory stock that matches posted documents",
      ru: "Склад цеха, который совпадает с документами",
    },
    industry: {
      en: "Furniture production & warehouse",
      ru: "Мебельное производство и склад",
    },
    context: {
      en: "Workshop + warehouse: multi-line receipts and issues, print forms for drivers, managers who need to reverse mistakes without chaos.",
      ru: "Цех + склад: мультистрочные приходы и списания, печать для водителей, менеджеры, которым нужна отмена ошибок без хаоса.",
    },
    problem: {
      en: "Stock and multi-line documents lived on paper and in chat photos. A wrong posting was almost impossible to reverse cleanly — people “fixed” balances with invent numbers. Print forms lagged the real floor; roles were “whoever has the shared laptop password”. Stakeholders touring the plant got binder photos instead of a system they could trust.",
      ru: "Склад и мультистрочные документы жили на бумаге и в фото из чатов. Ошибочное проведение почти нельзя было откатить чисто — остатки «чинили» инвентаризацией. Печать отставала от пола; роли — «у кого пароль от общего ноутбука». Стейкхолдерам на обходе показывали фото папки вместо системы, которой можно верить.",
    },
    did: {
      en: "Delivered CraftLine: FIFO warehouse, multi-line documents, controlled posting and unposting, PDF prints, roles and an audit trail for operators and management. Shop floor workflows mapped to real document types instead of free-form spreadsheets.",
      ru: "Внедрили CraftLine: FIFO-склад, мультистрочные документы, контролируемое проведение и отмена, PDF, роли и аудит для цеха и руководства. Процессы пола легли на реальные типы документов, а не на свободные таблицы.",
    },
    result: {
      en: "Stock movements match posted documents. Reverse posting is a deliberate, attributable action — not a midnight edit. The factory can open a live desk for partners instead of photographing binders. Management sees who changed what, which cuts chronic “someone adjusted the balance” arguments.",
      ru: "Движения склада совпадают с проведёнными документами. Отмена проведения — осознанное и атрибутированное действие, а не ночная правка. Цех открывает живой стол партнёрам вместо фото папки. Руководство видит, кто что менял — уходят споры «кто-то подкрутил остаток».",
    },
    metrics: [
      {
        value: "FIFO",
        label: {
          en: "warehouse movements tied to docs",
          ru: "движения склада привязаны к документам",
        },
      },
      {
        value: "audit",
        label: {
          en: "unpost with trail, not silent edits",
          ru: "отмена проведения с аудитом",
        },
      },
      {
        value: "live desk",
        label: {
          en: "shown to stakeholders instead of binders",
          ru: "стейкхолдерам — система, не папка",
        },
      },
    ],
    productIds: ["craftline"],
  },
  {
    id: "confectionery",
    title: {
      en: "Cost visible before the kitchen accepts the volume",
      ru: "Себестоимость видна до принятия объёма на кухне",
    },
    industry: {
      en: "Confectionery / dessert production",
      ru: "Кондитерское / dessert-производство",
    },
    context: {
      en: "Kitchen + small sales desk: recipes, ingredient stock, wholesale and retail orders, owner watching margins.",
      ru: "Кухня + небольшой стол продаж: техкарты, сырьё, опт и розница, владелец смотрит маржу.",
    },
    problem: {
      en: "Recipes lived in notebooks with unofficial “tweaks”. Ingredient write-offs happened after the fact — often days later — so stock never matched production. Confirming an order did not move costing and warehouse in one motion. The owner discovered margin holes only when purchasing again screamed that sugar “should still be there”.",
      ru: "Техкарты — в тетрадях с неофициальными «улучшениями». Списание сырья — постфактум, часто через дни, поэтому склад не совпадал с выпуском. Подтверждение заказа не двигало себестоимость и склад одним действием. Владелец узнавал про дыры в марже, когда закупки снова кричали, что сахар «ещё должен быть».",
    },
    did: {
      en: "Shaped BakeFlow: ingredient stock, recipe costing, order confirmation with automatic write-off, plus sales and a light finance view for the owner. One motion from “order accepted” to stock and cost movement — kitchen sees cost before committing volume.",
      ru: "Собрали BakeFlow: склад сырья, себестоимость техкарт, подтверждение заказа с автосписанием, продажи и лёгкий финконтур для владельца. Одно действие «заказ принят» двигает склад и себестоимость — кухня видит cost до принятия объёма.",
    },
    result: {
      en: "Kitchen discusses numbers before saying yes to large batches. Stock moves with the order instead of a weekly cleanup. The owner has a product narrative investors and partners understand — and a path to a full sandbox walkthrough on request, not a binder of recipes.",
      ru: "Кухня обсуждает цифры до «да» на крупный объём. Склад двигается с заказом, а не еженедельной зачисткой. У владельца есть продуктовый рассказ для инвестора и партнёра — и путь к полной песочнице по запросу, а не папка техкарт.",
    },
    metrics: [
      {
        value: "pre-accept",
        label: {
          en: "costing visible before volume commit",
          ru: "себестоимость до принятия объёма",
        },
      },
      {
        value: "auto write-off",
        label: {
          en: "stock moves with order confirm",
          ru: "склад со подтверждением заказа",
        },
      },
      {
        value: "owner desk",
        label: {
          en: "margin without notebook archaeology",
          ru: "маржа без археологии тетрадей",
        },
      },
    ],
    productIds: ["bakeflow"],
  },
  {
    id: "fashion-boutique",
    title: {
      en: "Size and color as one truth at closing",
      ru: "Размер и цвет — одна правда на закрытии дня",
    },
    industry: {
      en: "Fashion boutique retail",
      ru: "Fashion-бутик / retail",
    },
    context: {
      en: "Floor sales + small backroom stock: apparel SKUs by size/color, evening reconciliation, owners checking sell-through.",
      ru: "Продажи в зале + небольшой склад: SKU одежды по размеру/цвету, вечерняя сверка, владельцы смотрят sell-through.",
    },
    problem: {
      en: "SKU / size / color truth was fragmented across chat, the cash desk and “the other spreadsheet”. What sales claimed was sold disagreed with what hung on the floor. Closing meant arguing counts; markdowns and transfers vanished into informal notes. Partners asking for inventory reality got conflicting answers depending on who was closing that night.",
      ru: "Правда SKU / размер / цвет распадалась между чатом, кассой и «другой таблицей». То, что продажи считали проданным, не совпадало с залом. Закрытие дня — спор о остатках; уценки и перемещения тонули в неформальных заметках. Партнёрам про склад отвечали по-разному — в зависимости от того, кто закрывал смену.",
    },
    did: {
      en: "Built Atelier Retail: catalog discipline for apparel (size/color as first-class), warehouse and floor sales on one stock, owner analytics and finance snapshots in one product story — with a showcase for partners while a private live demo is scheduled.",
      ru: "Собрали Atelier Retail: дисциплина каталога одежды (размер/цвет как первоклассные поля), склад и продажи в зале на одном остатке, аналитика владельца и финансовые срезы в одной истории — showcase для партнёров, живой разбор по слоту.",
    },
    result: {
      en: "Size/color stay one truth from intake to sale. Sales and stock stop fighting at closing. Owners see sell-through without rebuilding sheets; partners walk a coherent showcase instead of three conflicting Excels.",
      ru: "Размер/цвет — одна правда от прихода до продажи. Продажи и склад не спорят на закрытии. Владельцы видят sell-through без сборки таблиц; партнёрам — связный showcase, а не три конфликтующих Excel.",
    },
    metrics: [
      {
        value: "1 SKU truth",
        label: {
          en: "size/color across floor and stock",
          ru: "размер/цвет в зале и на складе",
        },
      },
      {
        value: "calm close",
        label: {
          en: "day close without count wars",
          ru: "закрытие дня без войны пересчётов",
        },
      },
      {
        value: "owner view",
        label: {
          en: "sell-through without nightly sheets",
          ru: "sell-through без ночных таблиц",
        },
      },
    ],
    productIds: ["atelier"],
  },
  {
    id: "auto-parts",
    title: {
      en: "Parts desk with roles — not a shared password",
      ru: "Стол запчастей с ролями, а не общим паролем",
    },
    industry: {
      en: "Auto-parts warehouse",
      ru: "Склад автозапчастей",
    },
    context: {
      en: "Busy counter: lookup by part number, shift workers, owner who needed attribution without publishing master credentials.",
      ru: "Плотный прилавок: поиск по номеру, сменные сотрудники, владелец которому нужна атрибуция без публикации мастер-пароля.",
    },
    problem: {
      en: "Parts lookup and PIN profiles depended on who was on shift — tribal knowledge, not a system. Inventory counts drifted because actions were anonymous under a shared login. Demos for partners meant risking production credentials or staging a fake walkthrough. Shrink and mispicks were hard to assign.",
      ru: "Поиск запчастей и PIN зависели от того, кто на смене — знание людей, не система. Остатки «плыли», потому что действия были анонимны под общим входом. Демо для партнёров — либо риск боевых PIN, либо театральная инсценировка. Недостачи и ошибки сборки сложно было кому-то атрибутировать.",
    },
    did: {
      en: "Deployed PartStock: parts inventory, operational counter workflows and PIN profiles per role, plus an isolated sandbox path so diligence and demos never touch client production credentials.",
      ru: "Внедрили PartStock: номенклатура, процессы прилавка и PIN-профили по ролям, плюс изолированная песочница — проверка и демо никогда не трогают боевые PIN клиента.",
    },
    result: {
      en: "Operators work under roles, not a shared password. Warehouse actions are attributable — disputes have an author. Partner and investor walkthroughs use a sandbox login: the real catalog pattern without exposing production. Inventory discipline returned because the system remembers who did what.",
      ru: "Операторы работают под ролями, не под общим паролем. Действия по складу атрибутированы — у спора есть автор. Партнёры и инвесторы заходят в песочницу: тот же паттерн каталога без боевого доступа. Дисциплина остатков вернулась, потому что система помнит, кто что сделал.",
    },
    metrics: [
      {
        value: "PIN / role",
        label: {
          en: "no shared master password on shift",
          ru: "без общего мастер-пароля на смене",
        },
      },
      {
        value: "audit trail",
        label: {
          en: "every stock action has an author",
          ru: "у каждого действия по складу есть автор",
        },
      },
      {
        value: "sandbox",
        label: {
          en: "demos without production PIN",
          ru: "демо без боевого PIN",
        },
      },
    ],
    productIds: ["partstock"],
  },
  {
    id: "trading-desk",
    title: {
      en: "A trading workflow that became a named system",
      ru: "Торговый процесс, ставший именной системой",
    },
    industry: {
      en: "Client trading operations desk",
      ru: "Операционный торговый стол клиента",
    },
    context: {
      en: "Growing trading desk: custom exceptions, several roles, frequent partner and board reviews of the operating model.",
      ru: "Растущий торговый стол: свои исключения, несколько ролей, частые разборы операционной модели с партнёрами и советом.",
    },
    problem: {
      en: "The trading workflow outgrew ad-hoc tools. Exceptions multiplied into private worksheets; roles blurred between who could book, approve and reverse. Every stakeholder review meant rebuilding the process in slides — and by the next meeting the slides were already wrong. Ops risk lived in people’s heads.",
      ru: "Торговый процесс вырос из кустарных инструментов. Исключения размножились в личных таблицах; роли «кто бронирует / утверждает / откатывает» размылись. Каждый разбор для стейкхолдеров — заново собрать слайды, и к следующей встрече они уже врали. Операционный риск жил в головах людей.",
    },
    did: {
      en: "Shipped TradeDesk: a client-shaped operations ERP on a live host — documents and roles tuned to that trading flow, with a sandbox reopen for board and partner reviews so the next meeting opens the same desk, not a new deck.",
      ru: "Собрали TradeDesk: операционную ERP под процесс клиента на живом хосте — документы и роли под торговый поток, песочница для повторного показа совету и партнёрам: следующая встреча открывает тот же стол, а не новую колоду слайдов.",
    },
    result: {
      en: "Daily ops run inside a named product with clear roles. Exceptions are modeled, not whispered. The next diligence or board session reopens evidence that still matches reality. Custom work looks and behaves like a system the organization owns — not a rented generic template.",
      ru: "Ежедневные операции идут в именном продукте с ясными ролями. Исключения смоделированы, а не «на словах». Следующий diligence или совет открывает доказательства, которые ещё совпадают с реальностью. Кастом выглядит и ведёт себя как своя система — не арендованный generic.",
    },
    metrics: [
      {
        value: "named ERP",
        label: {
          en: "not a slide deck of the process",
          ru: "не слайды про процесс, а продукт",
        },
      },
      {
        value: "roles",
        label: {
          en: "book / approve / reverse separated",
          ru: "бронь / утверждение / откат разделены",
        },
      },
      {
        value: "reopen",
        label: {
          en: "same desk for every board review",
          ru: "тот же стол на каждом разборе",
        },
      },
    ],
    productIds: ["tradedesk"],
  },
  {
    id: "hr-department",
    title: {
      en: "Visa and timesheet fires caught before incidents",
      ru: "Визы и табель: ловим до инцидента",
    },
    industry: {
      en: "HR / people operations",
      ru: "Отдел кадров / people ops",
    },
    context: {
      en: "Mid-size employer with local and foreign workers: cards, visas, timesheets, leave, orders, management asking for weekly reports.",
      ru: "Средний работодатель с локальными и иностранными сотрудниками: карточки, визы, табель, отпуска, приказы, еженедельные отчёты руководству.",
    },
    problem: {
      en: "Employee cards, visas and timesheets lived across folders, chats and personal Excels. Foreign-worker expiries were discovered when someone was already blocked at a checkpoint — or when a manager asked “why isn’t he on site?”. Leadership waited days for reports assembled by hand; HR spent more time archaeology than people ops.",
      ru: "Карточки, визы и табель жили в папках, чатах и личных Excel. Сроки по иностранным работникам всплывали, когда человека уже не пропускали — или когда руководитель спрашивал «почему его нет на объекте?». Руководство ждало отчёты днями; HR больше занималось археологией файлов, чем people ops.",
    },
    did: {
      en: "Delivered StaffDesk: people cards, org chart, timesheets, leave, orders, foreign-worker expiry alerts and payroll/report exports — with TJ / RU / EN interfaces so the whole HR desk works in one product. Live demo walks the process without opening production personnel files.",
      ru: "Внедрили StaffDesk: карточки, оргструктура, табель, отпуска, приказы, оповещения о сроках по иностранным работникам и выгрузки — интерфейсы TJ / RU / EN, весь кадровый стол в одном продукте. Живое демо разбирает процесс без открытия боевых персональных дел.",
    },
    result: {
      en: "HR sees expiries before they become site incidents. Managers read the same reports without pinging “send the file”. Onboarding and leave stop living in unread chats. The department finally looks like an operating system for people — which matters for compliance and for trust from operational leadership.",
      ru: "HR видит сроки до инцидента на объекте. Руководители читают те же отчёты без «скинь файл». Онбординг и отпуска не живут в непрочитанных чатах. Отдел выглядит как операционная система для людей — это важно и для compliance, и для доверия операционного руководства.",
    },
    metrics: [
      {
        value: "alerts",
        label: {
          en: "foreign-worker expiries before blocks",
          ru: "сроки иностранцев до блокировок",
        },
      },
      {
        value: "same reports",
        label: {
          en: "management and HR share one view",
          ru: "руководство и HR смотрят одно",
        },
      },
      {
        value: "TJ/RU/EN",
        label: {
          en: "one desk for the whole HR team",
          ru: "один стол для всей кадровой команды",
        },
      },
    ],
    productIds: ["staffdesk"],
  },
  {
    id: "private-ops",
    title: {
      en: "When SaaS could not hold the client’s exceptions",
      ru: "Когда готовый SaaS не держал исключения клиента",
    },
    industry: {
      en: "Private custom operations suite",
      ru: "Закрытый кастомный операционный контур",
    },
    context: {
      en: "Confidential operator: off-the-shelf tools failed on edge cases; data and logic had to stay owned under NDA.",
      ru: "Закрытый оператор: готовые инструменты ломались на краевых случаях; логика и данные должны оставаться своими под NDA.",
    },
    problem: {
      en: "Generic SaaS forced the process into the product’s assumptions. Edge cases became shadow workflows outside the system — the worst of both worlds. Skinning a public template was unacceptable under confidentiality. Leadership needed an internal named product their team would actually run, and stakeholders needed controlled demos — not a marketing site of someone else’s template.",
      ru: "Чужой SaaS натягивал процесс на чужие допущения. Краевые случаи уходили в теневые контуры вне системы — худшее из двух миров. «Перекраска» публичного шаблона под конфиденциальностью была невозможна. Руководству нужен был именной внутренний продукт, которым команда реально работает, а заинтересованным сторонам — контролируемые демо, не маркетинговый сайт чужого шаблона.",
    },
    did: {
      en: "Delivered ClientOps as a privately scoped suite: custom document and role model, operator desk built around the real exceptions, controlled stakeholder demos under NDA. Discovery first, then a owned codebase and ops path — not a rented multi-tenant skin.",
      ru: "Поставили ClientOps как закрытый контур: своя модель документов и ролей, стол под реальные исключения, контролируемые демо под NDA. Сначала знакомство, затем свой код и путь эксплуатации — не арендованная «шкура» мультитенанта.",
    },
    result: {
      en: "The client runs a named internal product they own operationally. Exceptions live in the system instead of WhatsApp side channels. Investors and partners see the engagement pattern on a showcase; live access follows a short discovery — without publishing confidential process detail on a public page.",
      ru: "Клиент эксплуатирует именной внутренний продукт, которым владеет операционно. Исключения живут в системе, а не в боковых WhatsApp-каналах. Инвесторам и партнёрам — паттерн на обзоре; живой доступ после короткого знакомства — без публикации конфиденциального процесса на публичной странице.",
    },
    metrics: [
      {
        value: "owned",
        label: {
          en: "internal product, not rented SaaS skin",
          ru: "свой продукт, не арендованный SaaS",
        },
      },
      {
        value: "NDA demos",
        label: {
          en: "stakeholders see controlled evidence",
          ru: "стейкхолдерам — контролируемые доказательства",
        },
      },
      {
        value: "in-system",
        label: {
          en: "exceptions no longer in side chats",
          ru: "исключения больше не в боковых чатах",
        },
      },
    ],
    productIds: ["clientops"],
  },
];
