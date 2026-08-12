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
    id: "fuel-wholesale",
    title: {
      en: "Month-end close: days became hours",
      ru: "Закрытие месяца: дни превратились в часы",
    },
    industry: {
      en: "Wholesale fuel distribution",
      ru: "Оптовая дистрибуция топлива",
    },
    context: { en: "", ru: "" },
    problem: {
      en: "Purchases, sales and bank activity lived in Excel and were assembled from messenger screenshots of “deals”. Multi-currency contracts drifted from actual tank balances. Month-end close became a three-day reconciliation war. Auditors and partners constantly demanded reports that took endless calls and files to assemble.",
      ru: "Данные о поступлениях, реализации и банковских операциях велись в Excel и собирались по скриншотам «сделок» из мессенджеров. Мультивалютные контракты расходились с фактическими остатками в резервуарах. Закрытие месяца превращалось в трехдневную «войну сверок». Аудиторы и партнеры постоянно требовали отчеты, на подготовку которых уходило множество звонков и файлов.",
    },
    did: {
      en: "Shipped FuelOps — a single document system (receipts, sales, bank), operational journals and multi-currency print forms with role separation. Five scattered spreadsheets became one shared desk: ops posts on deal day, and finance sees current data immediately. Partners review the process in a separate test environment.",
      ru: "Внедрили FuelOps — единую систему документов (поступление, реализация, банк), операционных журналов и мультивалютных печатных форм с разграничением ролей. Пять разрозненных таблиц заменили одним общим рабочим столом: операции проводятся в день сделки, а финансовый отдел сразу видит актуальные данные. Для партнеров развернули тестовую песочницу без доступа к боевым данным.",
    },
    result: {
      en: "Deal-to-posted-document compressed from several days to a couple of hours. Finance no longer gathers data from chats. Tank balances and cash flows reconcile in real time. Leadership and partners work from the same current figures.",
      ru: "Процесс от сделки до проведения документа сократился с нескольких дней до пары часов. Финансовому отделу больше не нужно собирать данные по чатам. Остатки в резервуарах и денежные потоки сходятся в реальном времени. Руководство и партнеры работают с достоверными данными, а не заново собранными презентациями.",
    },
    metrics: [
      {
        value: "3d → hours",
        label: {
          en: "month-end close cycle reduced to hours",
          ru: "цикл закрытия месяца сократился до часов",
        },
      },
      {
        value: "1 journal",
        label: {
          en: "one shared journal instead of five reconciling files",
          ru: "один общий журнал вместо пяти файлов сверки",
        },
      },
      {
        value: "same day",
        label: {
          en: "deal posted and reflected in accounting the same day",
          ru: "проведение сделки и отражение в учете в тот же день",
        },
      },
    ],
    productIds: ["fuelops"],
  },
  {
    id: "weighbridge-whatsapp",
    title: {
      en: "Weighbridge totals the whole shift trusts",
      ru: "Итоги весовой, которым верит вся смена",
    },
    industry: {
      en: "Logistics · industrial weighbridge",
      ru: "Логистика · промышленная весовая",
    },
    context: { en: "", ru: "" },
    problem: {
      en: "Drivers sent scale-board photos into a WhatsApp group. Dispatchers retyped weights by hand — typos and approximate nets were normal. Gross and tare were negotiated by voice, and the daily total was rebuilt at night in Excel from chat history. Numbers disagreed, so drivers and clients argued constantly, and leadership did not trust the final tonnage.",
      ru: "Водители отправляли фото табло весов в WhatsApp-группу. Диспетчеры переносили вес вручную, из-за чего опечатки и примерные показатели нетто были нормой. Брутто и тару постоянно согласовывали голосом, а дневной итог собирали по ночам в Excel из истории чата. Из-за расхождения цифр водители и клиенты регулярно спорили, а руководство не доверяло итоговому тоннажу.",
    },
    did: {
      en: "Built ScaleGate around the habit they already had: photo + caption in the group. OCR reads gross from the photo, computes net for the linked truck, and the bot posts a confirmed report back to chat. A web panel keeps full history, search and roles. No new hardware on the scale — the process stayed in convenient WhatsApp.",
      ru: "Собрали ScaleGate вокруг привычного процесса: фото и подпись в группе. Алгоритм OCR автоматически распознает брутто на фото, вычисляет нетто для конкретной машины, а бот сразу публикует подтверждённый отчёт в чат. Веб-панель хранит всю историю, поддерживает поиск и разграничение ролей. Никакого нового железа на весах — весь процесс остался в удобном WhatsApp.",
    },
    result: {
      en: "Every weighing leaves a confirmed trail in minutes. Chat and web panel show the same numbers, so disputes fade. Nightly Excel rebuilds are gone — leadership sees ready totals on the panel. Drivers get a clear automatic confirmation instead of a subjective “ok” in chat.",
      ru: "Каждое взвешивание оставляет подтверждённый след в системе за считаные минуты. В чате и на веб-панели отображаются одинаковые цифры, что исключает споры. Ночной сбор данных в Excel полностью ушёл в прошлое — руководство видит готовые итоги на панели. Водитель получает четкое автоматическое подтверждение вместо субъективного «ок» в чате.",
    },
    metrics: [
      {
        value: "minutes",
        label: {
          en: "from scale photo to confirmed report",
          ru: "от фото на весах до подтверждённого отчета",
        },
      },
      {
        value: "1 truth",
        label: {
          en: "group chat and web panel numbers strictly match",
          ru: "данные чат-группы и веб-панели строго совпадают",
        },
      },
      {
        value: "no night Excel",
        label: {
          en: "manual nightly tonnage rebuild fully removed",
          ru: "ночной сбор тоннажа вручную полностью ликвидирован",
        },
      },
    ],
    productIds: ["scalegate"],
  },
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
    context: { en: "", ru: "" },
    problem: {
      en: "Inbound requests landed on managers’ personal WhatsApp numbers. Booking lived in a shared Google Sheet that lagged reality. Each site marked funnel stages its own way with chat labels. When an employee left, conversation history left with their phone. Owners received “reports” as screenshots of chats.",
      ru: "Заявки поступали на личные номера WhatsApp менеджеров. Запись велась в общем документе Google Sheets и постоянно отставала от реальности. Каждая точка отмечала стадии воронки по-своему с помощью ярлыков в чатах. Увольнение сотрудника приводило к потере истории общения вместе с его телефоном. Владельцы бизнеса получали отчеты в виде скриншотов переписок.",
    },
    did: {
      en: "Delivered MetodiOne CRM as a multi-tenant product: end-to-end pipeline stages across service lines, all chats in one desk, online booking inside the customer card, site vs HQ permissions, and live analytics. Piloted on one location, then rolled the finished contour to the whole network.",
      ru: "Внедрили MetodiOne CRM как мультитенантный продукт: настроили сквозные стадии воронки по всем линейкам услуг, объединили все чаты в одном рабочем окне и добавили онлайн-запись прямо в карточку клиента. Разграничили права доступа («точка» / «головной офис») и вывели живую аналитику. Запустили пилот на одной точке, после чего перенесли готовый контур на всю сеть.",
    },
    result: {
      en: "Customer requests no longer vanish on personal phones. Booking and the sales funnel sit on one profile. Shift handover is a task-status change, not a voice-note exchange. Leadership runs the business from a live dashboard. Training a new hire takes a couple of days instead of weeks shadowing other people’s chats.",
      ru: "Обращения клиентов больше не теряются на личных телефонах сотрудников. Запись и воронка продаж привязаны к одному профилю. Сдача смены теперь происходит простым изменением статуса задачи, а не обменом голосовыми сообщениями. Руководство контролирует бизнес через живой дашборд. Обучение нового сотрудника занимает пару дней вместо недель стажировки в чужих чатах.",
    },
    metrics: [
      {
        value: "0",
        label: {
          en: "leads left only on employees’ personal phones",
          ru: "лидов на личных телефонах сотрудников",
        },
      },
      {
        value: "1",
        label: {
          en: "shared controlled funnel across all branches and sites",
          ru: "общая контролируемая воронка на все филиалы и точки",
        },
      },
      {
        value: "same day",
        label: {
          en: "team working in the product on launch day",
          ru: "команда начинает работать в продукте в день запуска",
        },
      },
    ],
    productIds: ["metodione-crm"],
  },
  {
    id: "hr-department",
    title: {
      en: "Visas and timesheets — caught before the incident",
      ru: "Визы и табель — под контролем до инцидента",
    },
    industry: {
      en: "HR · people operations",
      ru: "Отдел кадров · People Ops",
    },
    context: { en: "", ru: "" },
    problem: {
      en: "Employee cards, visas and timesheets lived across scattered folders, chats and personal Excels. Document deadlines for foreign workers surfaced too late — when someone was already blocked from site access. Preparing analytics took HR days of file archaeology instead of real work with the team.",
      ru: "Карточки сотрудников, визы и табель учета рабочего времени велись в разрозненных папках, чатах и личных Excel-таблицах. Сроки действия документов иностранных работников всплывали слишком поздно — когда человека уже не пускали на объект. Подготовка аналитики занимала у HR-отдела дни: специалисты занимались «археологией» файлов вместо реальной работы с командой.",
    },
    did: {
      en: "Delivered StaffDesk: one system for employee cards, org chart, interactive timesheets, leave and orders. Added automatic alerts for critical document deadlines and practical exports. The interface is available in three languages (TJ / RU / EN), so the whole HR desk runs in one product.",
      ru: "Внедрили StaffDesk: единую систему, объединившую карточки сотрудников, оргструктуру, интерактивный табель, учет отпусков и приказов. Настроили автоматические оповещения о критических сроках документов и удобные выгрузки. Интерфейс локализован на три языка (TJ / RU / EN) — весь кадровый стол теперь в одном продукте. Живое демо позволяет протестировать процесс без открытия реальных персональных дел.",
    },
    result: {
      en: "HR sees critical deadlines long before site incidents. Managers get reports in one click, without chasing requests. Onboarding and leave approvals no longer disappear in chats. People ops became a transparent operating system for the team.",
      ru: "HR-отдел видит критические сроки задолго до возможных инцидентов на объектах. Руководители получают отчетность мгновенно и в один клик, без лишних запросов. Процессы онбординга и согласования отпусков больше не теряются в чатах. Кадровая служба стала прозрачной операционной системой для людей.",
    },
    metrics: [
      {
        value: "alerts",
        label: {
          en: "document deadline warnings before access blocks",
          ru: "предупреждения о сроках документов до возникновения блокировок",
        },
      },
      {
        value: "same reports",
        label: {
          en: "leadership and HR share one live dashboard",
          ru: "руководство и HR смотрят в один и тот же актуальный дашборд",
        },
      },
      {
        value: "TJ/RU/EN",
        label: {
          en: "one shared HR desk in three languages for the whole team",
          ru: "один общий кадровый стол на трех языках для всей команды",
        },
      },
    ],
    productIds: ["staffdesk"],
  },
  {
    id: "wechat-operator",
    title: {
      en: "International sales no longer live on one phone",
      ru: "Международные продажи больше не живут на одном телефоне",
    },
    industry: {
      en: "International messenger sales desk",
      ru: "Международный стол продаж в мессенджерах",
    },
    context: { en: "", ru: "" },
    problem: {
      en: "All inbound traffic hit operators’ personal phones. Counterparties were renamed by hand inside chats — there was no shared customer card. Integration bridges regularly failed on servers, and only one irreplaceable specialist could bring them back. An operator’s leave or departure froze sales and removed control over conversations.",
      ru: "Весь входящий трафик шел на личные телефоны операторов. Контрагентов переименовывали вручную прямо в чатах — единой карточки клиента не существовало. Интеграционные мосты регулярно падали на серверах, а восстановить их работоспособность мог только один незаменимый специалист. Уход или отпуск оператора парализовал продажи, лишая компанию контроля над переписками.",
    },
    did: {
      en: "Built MessageHub — a shared operator workspace. Counterparties are first-class customer cards with history. Configured inbound webhooks and a reliable integration bridge with a reproducible deploy path. Messenger work now happens inside a corporate product instead of on personal phones.",
      ru: "Разработали MessageHub — единое рабочее пространство (общий стол) оператора. Контрагенты ведутся как полноценные карточки клиентов с историей. Настроили входящие вебхуки и внедрили надежный интеграционный мост с воспроизводимым сценарием развертывания. Теперь вся работа в мессенджерах происходит внутри корпоративного продукта, а не на личных смартфонах сотрудников.",
    },
    result: {
      en: "Operator shift handover is instant and seamless — no manual chat copying. Leads are firmly attached to customer cards and easy to review or reassign. Bridge recovery became a standard procedure, not one person’s sacred knowledge. Continuity of international sales no longer depends on one mobile phone.",
      ru: "Передача смены между операторами теперь происходит мгновенно и бесшовно, без ручного копирования чатов. Все лиды жестко привязаны к карточкам клиентов — их легко проверить и передать коллеге. Восстановление интеграционного моста превратилось в стандартную регламентированную процедуру, а не в «сакральное знание» одного человека. Непрерывность международных продаж больше не зависит от стабильности одного мобильного телефона.",
    },
    metrics: [
      {
        value: "no-copy handover",
        label: {
          en: "operator shift handover without copying chat history",
          ru: "передача смены оператора без ручного копирования истории",
        },
      },
      {
        value: "reproducible bridge",
        label: {
          en: "messenger-bridge deploy path is automated",
          ru: "сценарий развертывания мессенджер-моста автоматизирован",
        },
      },
      {
        value: "independent sales",
        label: {
          en: "sales no longer depend on a physical smartphone being present",
          ru: "продажи не зависят от физического присутствия смартфона",
        },
      },
    ],
    productIds: ["messagehub"],
  },
  {
    id: "furniture-factory",
    title: {
      en: "Shop-floor stock that matches the documents",
      ru: "Склад цеха, который совпадает с документами",
    },
    industry: {
      en: "Furniture production and warehouse",
      ru: "Мебельное производство и склад",
    },
    context: { en: "", ru: "" },
    problem: {
      en: "Warehouse accounting and multi-line delivery notes lived on paper and as photos in chats. A wrongly posted operation was almost impossible to reverse without distorting the books, so balances were regularly “adjusted” by inventory. Print forms for drivers lagged actual shipments. Access control was chaos at the shared-laptop-password level. During partner visits, leadership showed folder photos on a phone instead of a transparent system.",
      ru: "Складской учет и многострочные накладные велись на бумаге и в виде фотографий в чатах. Ошибочно проведенную операцию было практически невозможно отменить без искажения учета, поэтому остатки регулярно «подгоняли» инвентаризацией. Печать документов для водителей постоянно отставала от фактической отгрузки. Права доступа распределялись хаотично на уровне «у кого пароль от общего ноутбука». Во время визитов партнерам показывали фото папок на телефоне вместо прозрачной системы.",
    },
    did: {
      en: "Delivered CraftLine: FIFO warehouse, controlled posting and unposting of multi-line documents, PDF generation, role separation and an end-to-end action audit. Shop-floor processes map onto clear document types.",
      ru: "Внедрили CraftLine: организовали склад по методу FIFO, внедрили контролируемое проведение и отмену многострочных документов, генерацию PDF-отчетов, разграничение ролей и сквозной аудит действий. Реальные процессы цеха легли на строгие типы документов, а не на хаотичные свободные таблицы.",
    },
    result: {
      en: "Every warehouse movement is tied to posted documents. Unposting is a deliberate action with an author trail. Leadership opens a live dashboard for partners instead of folder photos. Change history is transparent, so arguments about “who tweaked the stock” are gone.",
      ru: "Все движения на складе теперь строго привязаны к проведенным документам. Отмена операции стала осознанным действием с фиксацией автора изменений, а не скрытой ночной правкой. Вместо демонстрации папок руководство открывает перед партнерами живой рабочий дашборд. Вся история изменений прозрачна — споры о том, «кто подкрутил остатки», ушли в прошлое.",
    },
    metrics: [
      {
        value: "FIFO",
        label: {
          en: "all stock movements tightly tied to batch documents",
          ru: "все движения склада жестко привязаны к документам партии",
        },
      },
      {
        value: "audit",
        label: {
          en: "every post or unpost is recorded in the logs",
          ru: "любое проведение или отмена документа фиксируется в логах",
        },
      },
      {
        value: "live desk",
        label: {
          en: "partners see the live system instead of folder photos",
          ru: "вместо фото папок партнеры видят реальное состояние системы",
        },
      },
    ],
    productIds: ["craftline"],
  },
  {
    id: "confectionery",
    title: {
      en: "Batch cost is clear before the kitchen starts",
      ru: "Себестоимость видна ещё до запуска партии",
    },
    industry: {
      en: "Confectionery · dessert production",
      ru: "Кондитерское · dessert-производство",
    },
    context: { en: "", ru: "" },
    problem: {
      en: "Recipes and tech cards lived in notebooks with unofficial “improvements” from cooks. Ingredient write-offs happened after the fact — often days later — so warehouse stock never matched reality. Confirming an order did not trigger automatic costing. The owner learned about cash gaps and margin drops too late — when purchasing discovered ingredients were gone while the papers still said they “should be there”.",
      ru: "Рецептуры и технологические карты велись в тетрадях с «неофициальными улучшениями» от поваров. Списание сырья происходило постфактум, часто через несколько дней, из-за чего остатки на складе никогда не сходились с реальностью. Подтверждение заказа никак не влияло на автоматический расчет себестоимости. Владелец бизнеса узнавал о кассовых разрывах и падении маржинальности слишком поздно — когда при закупках выяснялось, что сырье закончилось, хотя по бумагам «еще должно быть».",
    },
    did: {
      en: "Built BakeFlow: ingredient stock, recipe costing and order confirmation with automatic write-off. Connected sales with the owner’s finance view. One action — moving an order to “Accepted” — instantly recalculates cost and writes off stock. The kitchen sees real batch cost before production starts.",
      ru: "Собрали BakeFlow: настроили склад сырья, калькуляцию себестоимости по техкартам и подтверждение заказов с автосписанием. Объединили продажи и финансовый контур владельца. Теперь одно действие — перевод заказа в статус «Принят» — мгновенно пересчитывает себестоимость и списывает остатки. Кухня видит реальную себестоимость партии до начала производства.",
    },
    result: {
      en: "Production sees exact numbers before confirming a large order volume. Ingredient stock moves with orders instead of a weekly cleanup. The owner has a clear margin view and can walk partners through the numbers without digging through recipe binders.",
      ru: "Производство видит точные цифры до того, как подтвердить крупный объем заказа. Движение сырья на складе синхронизировано с заказами, а не корректируется ручной зачисткой в конце недели. У владельца появился прозрачный инструмент для анализа маржинальности и демонстрации показателей инвесторам. Путь к тестовой песочнице открывается по первому запросу, без необходимости изучать папки с техкартами.",
    },
    metrics: [
      {
        value: "pre-accept",
        label: {
          en: "cost calculated before batch volume is confirmed",
          ru: "себестоимость рассчитывается до подтверждения объема партии",
        },
      },
      {
        value: "auto write-off",
        label: {
          en: "warehouse write-off tied to the Accepted status",
          ru: "складское списание привязано к статусу «Принят»",
        },
      },
      {
        value: "owner desk",
        label: {
          en: "margin control without digging through kitchen notebooks",
          ru: "контроль маржи без копания в кулинарных тетрадях",
        },
      },
    ],
    productIds: ["bakeflow"],
  },
  {
    id: "fashion-boutique",
    title: {
      en: "Size and color — unified stock at day close",
      ru: "Размер и цвет — единый учет на закрытии дня",
    },
    industry: {
      en: "Fashion boutique · retail",
      ru: "Fashion-бутик · retail",
    },
    context: { en: "", ru: "" },
    problem: {
      en: "There was no unified SKU / size / color accounting — data was scattered across chats, the cash desk and separate sheets. Sales in the system disagreed with what actually hung on the floor. Shift close became endless stock arguments; markdowns and transfers vanished into personal notes. Partners got different answers about availability depending on who closed the day.",
      ru: "Единый учет по SKU, размерам и цветам отсутствовал — данные были разбросаны между чатами, кассой и разрозненными таблицами. Информация о продажах в системе не совпадала с фактическим наличием вещей в торговом зале. Закрытие смены превращалось в бесконечный спор об остатках, а уценки и перемещения товара терялись в личных заметках. Партнеры получали разную информацию о наличии на складе в зависимости от того, кто именно из менеджеров закрывал день.",
    },
    did: {
      en: "Built Atelier Retail: structured the apparel catalog so size and color are first-class system fields. United warehouse stock and floor sales in one inventory contour. Delivered owner analytics and financial reporting, plus a transparent interactive showcase for partners with a fast walkthrough of the numbers.",
      ru: "Разработали Atelier Retail: структурировали каталог одежды, где размер и цвет стали ключевыми системными параметрами. Объединили складские запасы и розничные продажи в зале в рамках единого контура остатков. Вывели сквозную аналитику и финансовую отчетность для владельцев, создав прозрачную интерактивную витрину (showcase) для партнеров с возможностью быстрого разбора показателей.",
    },
    result: {
      en: "Size and color stay tracked from intake to receipt. Warehouse and floor teams no longer argue at shift close. Owners watch sell-through live without rebuilding sheets, and partners see one reliable data showcase instead of several conflicting Excels.",
      ru: "Параметры размера и цвета строго отслеживаются на всех этапах от поставки до чека. Складской и торговый отделы больше не спорят при закрытии смен. Владельцы контролируют показатель sell-through (продаваемость) в реальном времени без ручного сведения таблиц, а партнеры видят единую достоверную витрину данных вместо нескольких конфликтующих Excel-файлов.",
    },
    metrics: [
      {
        value: "1 SKU truth",
        label: {
          en: "size and color match on the floor and in the warehouse",
          ru: "размер и цвет совпадают в зале и на складе",
        },
      },
      {
        value: "calm close",
        label: {
          en: "shift close without stress and manual reconciliations",
          ru: "закрытие смены без стресса и сверок вручную",
        },
      },
      {
        value: "owner view",
        label: {
          en: "sell-through tracking without nightly Excel rebuilds",
          ru: "отслеживание sell-through без ночного сведения Excel",
        },
      },
    ],
    productIds: ["atelier"],
  },
  {
    id: "auto-parts",
    title: {
      en: "Parts stock: a personal PIN and an owner for every action",
      ru: "Склад запчастей: свой PIN и автор у каждого действия",
    },
    industry: {
      en: "Auto-parts warehouse",
      ru: "Склад автозапчастей",
    },
    context: { en: "", ru: "" },
    problem: {
      en: "Parts lookup and PIN-based picking depended on whoever was on shift. With no personal accounts, the whole team worked under one master password. The owner could not attribute actions to people — so responsibility for sales mistakes, bad returns and stock gaps was impossible to assign.",
      ru: "Поиск автозапчастей и подбор деталей по PIN-кодам зависели от опыта конкретного сотрудника на смене. Из-за отсутствия персональных учетных записей вся команда работала под общим «мастер-паролем». Владелец не мог отследить действия конкретных сотрудников, из-за чего было невозможно установить личную ответственность за ошибки в продажах, некорректно оформленные возвраты и расхождения на складе.",
    },
    did: {
      en: "Delivered PartStock: digitized the parts catalog, tuned exact number lookup, and separated permissions. Replaced the shared master password with personal accounts and PIN codes per shift worker. Every warehouse and cash action is now attributed to a concrete person.",
      ru: "Внедрили PartStock: оцифровали номенклатуру запчастей, настроили точные алгоритмы поиска по номерам и разграничили права доступа. Заменили единый мастер-пароль персональными учетными записями с PIN-кодами для каждого сменного сотрудника. Теперь каждое действие на складе и кассе автоматически привязывается к конкретному исполнителю.",
    },
    result: {
      en: "Operators work under personal roles. Every warehouse or cash action is transparent and auditable. The owner sees each employee’s contribution, and pick mistakes are found without interrogating the whole shift.",
      ru: "Операторы работают под своими персональными ролями, а не под общим паролем. Любое действие по складу или кассе теперь прозрачно и подлежит аудиту. Владелец видит личную эффективность каждого сотрудника, а ошибки при подборе запчастей легко выявляются и устраняются без долгих разбирательств со всей сменой.",
    },
    metrics: [
      {
        value: "PIN / role",
        label: {
          en: "personal PIN login — no shared master password",
          ru: "вход в систему по персональному PIN-коду без общего пароля",
        },
      },
      {
        value: "audit trail",
        label: {
          en: "every warehouse action has an author and is logged",
          ru: "каждое действие на складе имеет автора и фиксируется",
        },
      },
      {
        value: "sandbox",
        label: {
          en: "demos run on test data, separate from production PINs",
          ru: "демонстрация системы на тестовых данных, без реальных PIN",
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
    context: { en: "", ru: "" },
    problem: {
      en: "The trading process grew out of simple, handmade tools. Exceptions, rare paths and approvals multiplied unchecked in personal spreadsheets. Roles like who books, who approves and who rejects blurred. Every stakeholder review meant rebuilding presentation slides that were already wrong by the next meeting. Operational risk lived entirely in key people’s memory.",
      ru: "Торговый процесс вырос из простых, кустарных инструментов. Все исключения, редкие сценарии и согласования начали бесконтрольно размножаться в личных таблицах сотрудников. Роли вроде «кто бронирует», «кто утверждает» и «кто отказывает» размылись. Каждый разбор для стейкхолдеров требовал заново собирать слайды презентаций, которые к следующей встрече уже не соответствовали реальности. Операционный риск целиком зависел от памяти ключевых сотрудников.",
    },
    did: {
      en: "Built TradeDesk — an operations ERP shaped to the client’s real trading flow. Digitized documents and locked roles to the trading stream. Board and partner reviews open the same live desk every time.",
      ru: "Собрали TradeDesk — операционную ERP под реальный торговый процесс клиента на живом хосте. Оцифровали все документы и закрепили роли под торговый поток. Развернули изолированную песочницу для демонстрации системы совету директоров и партнерам: следующая встреча открывает тот же рабочий стол, а не новую колоду статичных слайдов.",
    },
    result: {
      en: "Daily ops run inside a named product with clear system roles. Exceptions are modeled in the UI. The next audit or partner board opens a live system that matches reality. The build behaves like the company’s own private system.",
      ru: "Ежедневные операции выполняются в именном продукте с четко прописанными, системными ролями. Все операционные исключения смоделированы в интерфейсе, а не обсуждаются «на словах». Следующий аудит или совет партнеров открывает живую систему, которая совпадает с реальностью. Кастомное решение выглядит и ведет себя как собственная закрытая система компании, а не арендованный безликий софт.",
    },
    metrics: [
      {
        value: "named ERP",
        label: {
          en: "named product instead of rebuilt meeting decks",
          ru: "индивидуальный продукт вместо бесконечных слайдов о процессах",
        },
      },
      {
        value: "roles",
        label: {
          en: "book / approve / cancel rights are strictly separated",
          ru: "права на бронь, утверждение и отмену операции строго разделены",
        },
      },
      {
        value: "reopen",
        label: {
          en: "the same up-to-date desk opens at every meeting",
          ru: "демонстрация одного и того же актуального стола на каждой встрече",
        },
      },
    ],
    productIds: ["tradedesk"],
  },
  {
    id: "private-ops",
    title: {
      en: "When off-the-shelf SaaS could not hold the exceptions",
      ru: "Когда готовый SaaS не выдержал исключений — собрали свой",
    },
    industry: {
      en: "Private custom operations contour",
      ru: "Закрытый кастомный операционный контур",
    },
    context: { en: "", ru: "" },
    problem: {
      en: "Third-party SaaS tried to impose someone else’s process assumptions on the business. Non-standard edge cases escaped into shadow manual workflows outside the system and created confusion. Attempts to “skin” a public template under strict confidentiality failed. Leadership needed an owned, named internal product that actually ran their logic and protected closed data.",
      ru: "Сторонний готовый SaaS-софт пытался навязать бизнесу чужие процессы и допущения. Нестандартные и краевые случаи уходили в «теневые» ручные контуры вне системы, создавая путаницу. Попытка «перекрасить» готовый публичный шаблон под строгие требования конфиденциальности провалилась. Руководству был необходим собственный, именной внутренний продукт, который реально работает с их логикой и защищает закрытые данные.",
    },
    did: {
      en: "Delivered ClientOps as a private system: custom document and role model, operator desk adapted to real exceptions, and a controlled demo under NDA. Engagement moved from introduction to a working build and then to full operation — software the client owns.",
      ru: "Поставили ClientOps как полностью закрытый и изолированный контур: спроектировали собственную модель документов и ролей, адаптировали рабочий стол под реальные исключения и развернули контролируемое демо под соглашением о неразглашении (NDA). Процесс сотрудничества начали со знакомства, перешли к тест-драйву кода и вышли на полную эксплуатацию — это собственное ПО, а не арендованная «шкурка» мультитенантной платформы.",
    },
    result: {
      en: "The client runs a named internal product and owns the operating infrastructure. Exceptions and non-standard paths are handled inside the system. Partners review the approach through a controlled demo after a short introduction.",
      ru: "Клиент эксплуатирует именной внутренний продукт и полностью владеет операционной инфраструктурой. Все исключения и нестандартные ситуации обрабатываются внутри системы, а не уходят в теневые каналы связи. Инвесторы и партнеры видят паттерн надежности на обзорах, а доступ к демо предоставляется после быстрого знакомства — без публикации закрытых процессов на публичном стенде.",
    },
    metrics: [
      {
        value: "not SaaS",
        label: {
          en: "owned software under client control",
          ru: "собственный софт под контролем клиента, а не аренда платформы",
        },
      },
      {
        value: "NDA secure",
        label: {
          en: "data and logic protected and isolated inside the contour",
          ru: "все данные и логика защищены и изолированы внутри контура",
        },
      },
      {
        value: "exception ready",
        label: {
          en: "system designed for non-standard edge scenarios",
          ru: "система спроектирована под нестандартные краевые сценарии",
        },
      },
    ],
    productIds: ["clientops"],
  },
];
