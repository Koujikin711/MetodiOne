export type ProductShowcase = {
  id: string;
  productId: string;
  title: { en: string; ru: string };
  lead: { en: string; ru: string };
  modules: { en: string; ru: string }[];
  audience: { en: string; ru: string };
};

export const PRODUCT_SHOWCASES: ProductShowcase[] = [
  {
    id: "bakeflow",
    productId: "bakeflow",
    title: {
      en: "BakeFlow — confectionery operations",
      ru: "BakeFlow — операции кондитерской",
    },
    lead: {
      en: "A dessert kitchen needs recipe costing and stock that moves when an order is confirmed — not a generic inventory app. BakeFlow is that desk; a full public sandbox is provisioned on request while this showcase explains the product shape.",
      ru: "Кондитерской нужны техкарты и склад, который двигается при подтверждении заказа — не общий «учёт». BakeFlow — это рабочее место; публичный sandbox выдаём по запросу, здесь — форма продукта.",
    },
    modules: [
      { en: "Ingredients & FIFO stock", ru: "Сырьё и FIFO-склад" },
      { en: "Recipe cards with costing", ru: "Техкарты с себестоимостью" },
      { en: "Orders with auto write-off", ru: "Заказы с автосписанием" },
      { en: "Sales & light finance views", ru: "Продажи и лёгкий финконтур" },
    ],
    audience: {
      en: "Bakeries, dessert studios, small food manufacturers",
      ru: "Кондитерские, dessert-студии, небольшие пищевые производства",
    },
  },
  {
    id: "atelier",
    productId: "atelier",
    title: {
      en: "Atelier Retail — fashion boutique ERP",
      ru: "Atelier Retail — ERP fashion-бутика",
    },
    lead: {
      en: "Apparel retail dies when size/color truth fragments across chat and cash. Atelier Retail keeps catalog, stock and sales coherent — showcase now, scheduled web sandbox next.",
      ru: "Fashion-retail ломается, когда размер/цвет живут в чатах и на кассе по-разному. Atelier Retail держит каталог, склад и продажи вместе — сейчас showcase, web-sandbox по слоту.",
    },
    modules: [
      { en: "SKU / size / color catalog", ru: "Каталог SKU / размер / цвет" },
      { en: "Warehouse & floor sales", ru: "Склад и продажи в зале" },
      { en: "Analytics for owners", ru: "Аналитика для владельца" },
      { en: "Finance snapshot views", ru: "Финансовые срезы" },
    ],
    audience: {
      en: "Boutiques and multi-brand apparel shops",
      ru: "Бутики и мультибрендовые магазины одежды",
    },
  },
  {
    id: "clientops",
    productId: "clientops",
    title: {
      en: "ClientOps — private delivery case",
      ru: "ClientOps — закрытый кейс внедрения",
    },
    lead: {
      en: "A privately scoped operational suite for a client whose process could not sit on public SaaS. We document the engagement pattern here; live access is arranged after a short discovery under confidentiality.",
      ru: "Закрытый операционный контур для клиента, чей процесс нельзя посадить на публичный SaaS. Здесь — паттерн внедрения; живой доступ — после короткого discovery под конфиденциальностью.",
    },
    modules: [
      { en: "Custom document & role model", ru: "Своя модель документов и ролей" },
      { en: "Operator desk tuned to exceptions", ru: "Стол оператора под исключения" },
      { en: "Controlled stakeholder demos", ru: "Контролируемые демо для стейкхолдеров" },
      { en: "Retention & iteration path", ru: "Путь сопровождения и итераций" },
    ],
    audience: {
      en: "Private firms needing ownership of logic and data",
      ru: "Компании, которым важно владение логикой и данными",
    },
  },
];

export function getShowcase(id: string): ProductShowcase | undefined {
  return PRODUCT_SHOWCASES.find((s) => s.id === id);
}
