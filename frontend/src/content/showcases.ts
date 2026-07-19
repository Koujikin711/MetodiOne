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
      en: "BakeFlow connects recipes, ingredient stock and orders: when an order is confirmed, stock is recalculated automatically. A public demo is available on request; the modules below are what the product covers.",
      ru: "BakeFlow связывает техкарты, склад сырья и заказы: при подтверждении заказа остатки пересчитываются автоматически. Публичное демо — по запросу; ниже — модули продукта.",
    },
    modules: [
      { en: "Ingredients & FIFO warehouse", ru: "Сырьё и FIFO-склад" },
      {
        en: "Tech cards with automatic cost calculation",
        ru: "Технологические карты с расчётом себестоимости",
      },
      { en: "Orders with automatic stock write-off", ru: "Заказы с автосписанием остатков" },
      {
        en: "Sales and operational finance views",
        ru: "Продажи и операционные финансы",
      },
    ],
    audience: {
      en: "Confectioneries, dessert studios and small food manufacturers",
      ru: "Кондитерские, десерт-студии и небольшие пищевые производства",
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
      en: "Atelier Retail keeps catalog, warehouse and floor sales aligned by size and color. This page is a product preview; a full web demo is available on request.",
      ru: "Atelier Retail держит каталог, склад и продажи в зале в одной логике размера и цвета. Здесь — обзор продукта; полное веб-демо — по запросу.",
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
      en: "A private operations suite for a client whose process could not run on public SaaS. Live access is arranged after a short discovery under NDA.",
      ru: "Закрытый операционный контур для клиента, чей процесс нельзя вынести в публичный SaaS. Живой доступ — после короткого знакомства под NDA.",
    },
    modules: [
      { en: "Custom document and role model", ru: "Своя модель документов и ролей" },
      { en: "Operator desk tuned to exceptions", ru: "Стол оператора под исключения" },
      { en: "Controlled demos for stakeholders", ru: "Контролируемые демо для заинтересованных сторон" },
      { en: "Support and iteration path", ru: "Сопровождение и развитие" },
    ],
    audience: {
      en: "Firms that need ownership of logic and data",
      ru: "Компании, которым важно владение логикой и данными",
    },
  },
];

export function getShowcase(id: string): ProductShowcase | undefined {
  return PRODUCT_SHOWCASES.find((s) => s.id === id);
}
