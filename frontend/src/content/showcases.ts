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
      en: "A pastry kitchen needs tech cards and a warehouse that recalculates automatically when an order is confirmed — not abstract generic accounting. BakeFlow is a ready workspace for running your production. We provision a public sandbox on request; below are the key product capabilities.",
      ru: "Кондитерской нужны технологические карты и склад, который автоматически пересчитывается при подтверждении заказа, а не абстрактный общий учет. BakeFlow — это готовое рабочее место для управления вашим производством. Публичную песочницу мы разворачиваем по запросу, а ниже — ключевые возможности продукта.",
    },
    modules: [
      { en: "Ingredients & FIFO warehouse", ru: "Сырьё и FIFO-склад" },
      {
        en: "Tech cards with automatic cost calculation",
        ru: "Технологические карты с автоматическим расчетом себестоимости",
      },
      { en: "Orders with automatic stock write-off", ru: "Заказы с автосписанием остатков" },
      {
        en: "Sales and an operational finance contour",
        ru: "Продажи и операционный финансовый контур",
      },
    ],
    audience: {
      en: "Confectioneries, dessert studios and small food manufacturers.",
      ru: "Кондитерские, десерт-студии и небольшие пищевые производства.",
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
      ru: "Fashion-ритейл ломается, когда размер/цвет живут в чатах и на кассе по-разному. Atelier Retail держит каталог, склад и продажи вместе — сейчас обзор, веб-песочница по слоту.",
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
      ru: "Закрытый операционный контур для клиента, чей процесс нельзя посадить на публичный SaaS. Здесь — паттерн внедрения; живой доступ — после короткого знакомства под конфиденциальностью.",
    },
    modules: [
      { en: "Custom document & role model", ru: "Своя модель документов и ролей" },
      { en: "Operator desk tuned to exceptions", ru: "Стол оператора под исключения" },
      { en: "Controlled stakeholder demos", ru: "Контролируемые демо для заинтересованных сторон" },
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
