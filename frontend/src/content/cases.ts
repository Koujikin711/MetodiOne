export type StudioCase = {
  id: string;
  industry: { en: string; ru: string };
  problem: { en: string; ru: string };
  did: { en: string; ru: string };
  result: { en: string; ru: string };
  productIds: string[];
};

/** Anonymized delivery stories for every portfolio product. */
export const STUDIO_CASES: StudioCase[] = [
  {
    id: "crm-service",
    industry: {
      en: "Service business / multi-location CRM",
      ru: "Сервисный бизнес / мультилокационная CRM",
    },
    problem: {
      en: "Leads lived in personal WhatsApp chats, booking was a Google Sheet, and managers could not see the same funnel. Owners asked for KPI and got screenshots.",
      ru: "Лиды жили в личных WhatsApp-чатах, запись — в Google Sheet, менеджеры смотрели разные воронки. Владельцы просили KPI и получали скриншоты.",
    },
    did: {
      en: "Shipped MetodiOne CRM: shared stages, omnichannel chat, online booking, roles and analytics on one multi-tenant product the team could log into the same day.",
      ru: "Собрали MetodiOne CRM: общие стадии, омниканал-чат, онлайн-запись, роли и аналитика в одном мультитенант-продукте, куда команда вошла в тот же день.",
    },
    result: {
      en: "Incoming requests stop disappearing in personal phones; booking and pipeline share one customer truth; owners open a live desk instead of asking for “the table”.",
      ru: "Заявки перестали пропадать в личных телефонах; запись и воронка на одной клиентской правде; владелец открывает живое рабочее место, а не просит «таблицу».",
    },
    productIds: ["metodione-crm"],
  },
  {
    id: "fuel-wholesale",
    industry: {
      en: "Wholesale fuel trade",
      ru: "Оптовая торговля топливом",
    },
    problem: {
      en: "Purchases, sales and bank docs lived in Excel + messenger screenshots. Multi-currency contracts drifted from tank reality; month-end took days and still disagreed.",
      ru: "Поступления, реализации и банк жили в Excel и скриншотах из мессенджеров. Мультивалютные контракты расходились с фактом по резервуарам; закрытие месяца занимало дни и всё равно не сходилось.",
    },
    did: {
      en: "Shipped FuelOps: document flow (purchases/sales/bank), journals, multi-currency print forms and tank-aware operations with role access — one operational desk instead of five tables.",
      ru: "Собрали FuelOps: контур документов (поступления/реализации/банк), журналы, мультивалютные печатные формы и учёт с ролями — одно рабочее место вместо пяти таблиц.",
    },
    result: {
      en: "Ops team posts documents the same day; finance reviews a single journal; stakeholder demos use a live sandbox, not a deck. Cycle time from “deal done” to “posted” dropped from days to hours.",
      ru: "Операции проводят документы в день сделки; финансы смотрят один журнал; стейкхолдерам показывают живой sandbox, а не слайды. От «сделка» до «проведено» — часы вместо дней.",
    },
    productIds: ["fuelops"],
  },
  {
    id: "wechat-operator",
    industry: {
      en: "Cross-border messenger sales desk",
      ru: "Международный стол продаж в мессенджерах",
    },
    problem: {
      en: "WeChat and WhatsApp traffic hit personal phones. Counterparties were renamed in chats, installers fought bridge crashes, and no one could hand a clean history to a new operator.",
      ru: "Трафик WeChat и WhatsApp шёл на личные телефоны. Контрагентов переименовывали в чатах, мосты падали у установщиков, новому оператору нечего было передать как историю.",
    },
    did: {
      en: "Built MessageHub: operator desk, counterparties, inbound webhooks and installable bridges so messenger work sits in a product, not in a private device.",
      ru: "Собрали MessageHub: стол оператора, контрагенты, inbound webhooks и устанавливаемые мосты — работа в мессенджерах в продукте, а не на личном устройстве.",
    },
    result: {
      en: "Shift handovers became possible; leads stay attached to accounts; bridge install is a repeatable path instead of “call the guy who knows”.",
      ru: "Смена оператора стала возможной; лиды привязаны к карточкам; установка моста — повторяемый сценарий, а не «позвони тому, кто знает».",
    },
    productIds: ["messagehub"],
  },
  {
    id: "weighbridge-whatsapp",
    industry: {
      en: "Logistics / weighbridge",
      ru: "Логистика / весовая",
    },
    problem: {
      en: "Drivers photographed the scale board into a WhatsApp group. Dispatchers typed weights by hand, net was argued verbally, and nobody trusted the daily total.",
      ru: "Водители слали фото табло весов в WhatsApp-группу. Диспетчеры перебивали вес вручную, нетто спорили голосом, дневному итогу никто не верил.",
    },
    did: {
      en: "Built ScaleGate: photo + caption intake, OCR for gross, net = current − previous, report back to the group with confirmation, web panel for history and roles.",
      ru: "Собрали ScaleGate: приём фото с подписью, OCR брутто, нетто = текущий − предыдущий, отчёт в группу с подтверждением, веб-панель истории и ролей.",
    },
    result: {
      en: "Weighings leave an auditable trail in minutes; disputes fall because the group sees the same numbers the panel stores. Ops stopped rebuilding the day in Excel at night.",
      ru: "Взвешивания дают аудируемый след за минуты; споры падают, потому что группа видит те же цифры, что панель. Ночной «сбор дня» в Excel исчез.",
    },
    productIds: ["scalegate"],
  },
  {
    id: "furniture-factory",
    industry: {
      en: "Furniture production & warehouse",
      ru: "Мебельное производство и склад",
    },
    problem: {
      en: "Workshop stock and multi-line documents were paper + chat. Posting mistakes were hard to reverse; print forms and roles lagged behind the real shop floor.",
      ru: "Склад цеха и мультистрочные документы жили в бумаге и чатах. Ошибки проведения сложно откатывались; печать и роли отставали от реального пола.",
    },
    did: {
      en: "Delivered CraftLine: FIFO warehouse, multi-line docs, posting/unposting, PDF prints, roles and audit for factory operators and managers.",
      ru: "Внедрили CraftLine: FIFO-склад, мультистрочные документы, проведение/отмена, PDF, роли и аудит для цеха и руководства.",
    },
    result: {
      en: "Stock movements match posted documents; reverse posting is a controlled action; the factory can show stakeholders a live system instead of binder photos.",
      ru: "Движения склада совпадают с проведёнными документами; отмена проведения — контролируемое действие; цех показывает стейкхолдерам живую систему, а не фото папки.",
    },
    productIds: ["craftline"],
  },
  {
    id: "confectionery",
    industry: {
      en: "Confectionery / dessert production",
      ru: "Кондитерская / dessert-производство",
    },
    problem: {
      en: "Recipes lived in notebooks, ingredient write-offs happened after the fact, and order confirmation never touched stock costing in one motion.",
      ru: "Техкарты — в тетрадях, списание сырья — постфактум, подтверждение заказа не двигало склад и себестоимость одним действием.",
    },
    did: {
      en: "Shaped BakeFlow: ingredient stock, recipe costing, order confirmation with automatic write-off, plus sales and light finance views for the owner.",
      ru: "Собрали BakeFlow: склад сырья, себестоимость техкарт, подтверждение заказа с автосписанием, продажи и лёгкий финконтур для владельца.",
    },
    result: {
      en: "Kitchen sees cost before accepting volume; stock moves with the order; owners discuss a product narrative investors can follow — full sandbox on request.",
      ru: "Кухня видит себестоимость до принятия объёма; склад двигается вместе с заказом; владельцам есть продуктовый нарратив для инвестора — полный sandbox по запросу.",
    },
    productIds: ["bakeflow"],
  },
  {
    id: "fashion-boutique",
    industry: {
      en: "Fashion boutique retail",
      ru: "Fashion-бутик / retail",
    },
    problem: {
      en: "SKU / size / color truth fragmented across chat, cash desk and “the other spreadsheet”. Stock on the floor disagreed with what sales claimed was sold.",
      ru: "Правда SKU / размер / цвет распадалась между чатом, кассой и «другой таблицей». Склад в зале расходился с тем, что продажи считали проданным.",
    },
    did: {
      en: "Built Atelier Retail: catalog discipline for apparel, warehouse and floor sales, owner analytics and finance snapshots in one product story.",
      ru: "Собрали Atelier Retail: дисциплина каталога одежды, склад и продажи в зале, аналитика владельца и финансовые срезы в одной продуктовой истории.",
    },
    result: {
      en: "Size/color stays one truth; sales and stock stop arguing at closing; partners can walk a showcase while a private demo slot is arranged.",
      ru: "Размер/цвет остаются одной правдой; продажи и склад не спорят на закрытии дня; партнёрам показывают showcase, а живой разбор — по слоту.",
    },
    productIds: ["atelier"],
  },
  {
    id: "auto-parts",
    industry: {
      en: "Auto-parts warehouse",
      ru: "Склад автозапчастей",
    },
    problem: {
      en: "Parts lookup and PIN profiles depended on who was on shift. Inventory counts drifted; ops needed a fast desk without exposing owner credentials.",
      ru: "Поиск запчастей и PIN-профили зависели от того, кто на смене. Остатки «плыли»; нужен был быстрый стол без владельческих паролей в общем доступе.",
    },
    did: {
      en: "Deployed PartStock: parts inventory, operational workflows and PIN profiles for spare-parts warehouses with a sandbox path for demos.",
      ru: "Внедрили PartStock: номенклатура, операционные процессы и PIN-профили для склада автозапчастей с sandbox-путём для демо.",
    },
    result: {
      en: "Operators work under roles, not shared passwords; inventory actions are attributable; diligence uses a sandbox login — never client production PIN.",
      ru: "Операторы работают под ролями, не под общим паролем; действия по складу атрибутированы; для diligence — sandbox, никогда не клиентский PIN.",
    },
    productIds: ["partstock"],
  },
  {
    id: "trading-desk",
    industry: {
      en: "Client trading operations desk",
      ru: "Операционный торговый стол клиента",
    },
    problem: {
      en: "A trading workflow outgrew ad-hoc tools: exceptions multiplied, roles blurred, and every stakeholder review meant rebuilding the process in slides.",
      ru: "Торговый процесс вырос из кустарных инструментов: множились исключения, роли размылись, каждый разбор для стейкхолдеров собирали заново в слайдах.",
    },
    did: {
      en: "Shipped TradeDesk: a client-shaped operations ERP on a live host — documents and roles tuned to that trading flow, reopening in a sandbox for reviews.",
      ru: "Собрали TradeDesk: операционная ERP под процесс клиента на живом хосте — документы и роли под торговый поток, повторный показ из песочницы.",
    },
    result: {
      en: "Daily ops run in the product; the next board or partner meeting reopens the same desk; custom work still looks and behaves like a named system.",
      ru: "Ежедневные операции идут в продукте; следующий совет или партнёр открывают тот же стол; кастом выглядит и ведёт себя как именная система.",
    },
    productIds: ["tradedesk"],
  },
  {
    id: "hr-department",
    industry: {
      en: "HR department / people operations",
      ru: "Отдел кадров / people ops",
    },
    problem: {
      en: "Employee cards, visas and timesheets lived across folders and chats. Foreign-worker expiries were missed; management asked for reports and waited for manual Excel.",
      ru: "Карточки сотрудников, визы и табель жили в папках и чатах. Сроки по иностранным работникам пропускали; руководство ждало отчёты из ручного Excel.",
    },
    did: {
      en: "Delivered StaffDesk: people cards, org chart, timesheets, leave, orders, foreign-worker alerts and payroll/report exports with TJ/RU/EN interfaces.",
      ru: "Внедрили StaffDesk: карточки, оргструктура, табель, отпуска, приказы, оповещения по иностранным работникам и выгрузки — интерфейсы TJ/RU/EN.",
    },
    result: {
      en: "HR sees expiries before they become incidents; managers read the same reports; a live demo walks the process without opening production HR files.",
      ru: "HR видит сроки до инцидента; руководство читает те же отчёты; живое демо разбирает процесс без открытия боевых кадровых файлов.",
    },
    productIds: ["staffdesk"],
  },
  {
    id: "private-ops",
    industry: {
      en: "Private custom operations suite",
      ru: "Закрытый кастомный операционный контур",
    },
    problem: {
      en: "Off-the-shelf SaaS could not hold the client’s exceptions. Data and logic had to stay owned; public template skinning was a non-starter under confidentiality.",
      ru: "Готовый SaaS не держал исключения клиента. Логика и данные должны оставаться своими; «перекраска шаблона» под конфиденциальностью была невозможна.",
    },
    did: {
      en: "Delivered ClientOps as a privately scoped suite: custom document/role model, operator desk for exceptions, controlled stakeholder demos under NDA.",
      ru: "Поставили ClientOps как закрытый контур: своя модель документов и ролей, стол под исключения, контролируемые демо для стейкхолдеров под NDA.",
    },
    result: {
      en: "The client runs a named internal product, not a rented template; investors see the engagement pattern on a showcase and live access after short discovery.",
      ru: "Клиент эксплуатирует именной внутренний продукт, а не арендованный шаблон; инвесторам — паттерн на showcase, живой доступ после короткого discovery.",
    },
    productIds: ["clientops"],
  },
];
