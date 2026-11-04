/** Короткий заголовок раздела кабинета РОП. */

export function RopPageIntro({ title, hint }: { title: string; hint: string }) {
  return (
    <header className="rop-page-intro print-screen-only">
      <h2 className="rop-page-intro__title">{title}</h2>
      <p className="rop-page-intro__hint">{hint}</p>
    </header>
  );
}
