/**
 * Размеры окна приложения: `--app-h` и `--kb-h`.
 *
 * Нижняя панель прижата к низу не свойством `position`, а устройством
 * страницы: `body` — колонка ровно в высоту окна, которая сама не
 * прокручивается, а прокрутка живёт внутри содержимого (index.css). При
 * таком каркасе панели просто некуда уехать — но высоту окна нужно знать
 * точно, а надёжного способа взять её из одного лишь CSS на iOS нет:
 *
 * - `100vh` не учитывает панели Safari, и низ уезжает под них;
 * - `100dvh` пересчитывается рывками во время инерционного скролла — панель
 *   мигает и на кадр-другой всё равно оказывается за краем экрана.
 *
 * Честный источник один — `visualViewport`, и читать его приходится из JS.
 * Он подходит и в браузере, и в установленном приложении: статус-бар у нас
 * непрозрачный (`apple-mobile-web-app-status-bar-style` = `default` в
 * index.html), поэтому вебвью не заезжает под него, и занижения высоты, из-за
 * которого пришлось бы мерить экран целиком, не возникает.
 */

/**
 * Ниже этого зазора это не клавиатура, а строка статуса или панель Safari.
 * Клавиатура всегда высокая, так что грубого порога достаточно.
 */
const KEYBOARD_MIN_HEIGHT = 120;

/** iOS обновляет размеры окна не сразу после поворота — домеряем позже. */
const ORIENTATION_SETTLE_MS = 300;

/** Снимок размеров окна — всё, что нужно, чтобы посчитать каркас. */
export interface ViewportReading {
  /** Высота слоя разметки. */
  innerHeight: number;
  /** Высота видимой области; `null`, если `visualViewport` не поддержан. */
  visualHeight: number | null;
  /** На сколько видимая область сдвинута вниз внутри слоя разметки. */
  visualOffsetTop: number;
  /** Приложение открыто с домашнего экрана, а не во вкладке браузера. */
  isStandalone: boolean;
}

/** Что из снимка попадает в CSS-переменные. */
export interface ShellMetrics {
  /** Высота оболочки приложения, `--app-h`. */
  appHeight: number;
  /** Насколько низ окна закрыт клавиатурой, `--kb-h`. */
  keyboardHeight: number;
}

/**
 * Считает высоту оболочки и клавиатуры по снимку размеров.
 *
 * Клавиатура опознаётся как разница между слоем разметки (он от неё не
 * меняется) и видимой областью (она съёживается). `previousAppHeight` нужен
 * ровно для одного случая — см. комментарий внутри.
 */
export function measureShell(
  reading: ViewportReading,
  previousAppHeight: number
): ShellMetrics {
  const { innerHeight, visualHeight, visualOffsetTop, isStandalone } = reading;

  // Без visualViewport (старые Android-браузеры) остаётся innerHeight: он
  // хотя бы не врёт про панели, потому что их там нет
  if (visualHeight === null) {
    return { appHeight: Math.round(innerHeight), keyboardHeight: 0 };
  }

  // Нижняя граница того, что человек сейчас видит
  const visibleBottom = visualHeight + visualOffsetTop;

  if (isStandalone) {
    // В установленном приложении высота окна постоянна: панелей, которые
    // могли бы её менять, нет вовсе. Меняться может только видимая часть —
    // её съедает клавиатура. Значит правильная высота окна это **наибольшая
    // виденная**, и её достаточно один раз запомнить.
    //
    // Так надёжнее, чем вычислять её каждый раз. Раньше высота бралась из
    // текущего замера, а «клавиатура поднята» опознавалась по расхождению
    // innerHeight и visualViewport — но на iOS в установленном приложении
    // при поднятой клавиатуре проседают **оба**. Расхождения нет, клавиатура
    // не опознавалась, и оболочка ужималась до щели над ней. Обратно она уже
    // не раскладывалась: следующий замер приходил с той же просевшей высотой.
    // Максимум такого не допускает по построению — и сам себя чинит, если
    // первый замер всё же случился при поднятой клавиатуре.
    const appHeight = Math.max(
      previousAppHeight,
      Math.round(innerHeight),
      Math.round(visibleBottom)
    );
    // Клавиатуру считаем от настоящей высоты окна, а не от innerHeight:
    // именно потому, что тот вместе с ней и проседает
    const covered = appHeight - visibleBottom;
    return {
      appHeight,
      keyboardHeight: covered > KEYBOARD_MIN_HEIGHT ? Math.round(covered) : 0,
    };
  }

  // В браузере окно меняется по-настоящему: Safari показывает и прячет свои
  // панели. Тут наибольшее значение не годится — низ ушёл бы под панель
  const covered = innerHeight - visibleBottom;
  const keyboardHeight = covered > KEYBOARD_MIN_HEIGHT ? Math.round(covered) : 0;

  // Пока клавиатура поднята, visualViewport показывает щель над ней, а не
  // окно приложения. Пересчитать по нему оболочку — значит сплющить весь
  // интерфейс на время ввода, а потом разложить обратно.
  return {
    appHeight: keyboardHeight > 0 ? previousAppHeight : Math.round(visualHeight),
    keyboardHeight,
  };
}

/** Снимок текущих размеров окна. */
export function readViewport(): ViewportReading {
  const visual = window.visualViewport;
  return {
    innerHeight: window.innerHeight,
    visualHeight: visual ? visual.height : null,
    visualOffsetTop: visual ? visual.offsetTop : 0,
    isStandalone:
      window.matchMedia('(display-mode: standalone)').matches ||
      // iOS до сих пор сообщает об этом собственным нестандартным полем
      (navigator as { standalone?: boolean }).standalone === true,
  };
}

/**
 * Начинает следить за размерами окна и держать `--app-h` и `--kb-h`
 * в актуальном состоянии. Возвращает функцию отписки.
 */
export function installViewportMetrics(): () => void {
  const root = document.documentElement;
  let appHeight = window.innerHeight;
  let settleTimer = 0;

  const update = () => {
    const metrics = measureShell(readViewport(), appHeight);
    appHeight = metrics.appHeight;
    root.style.setProperty('--app-h', `${metrics.appHeight}px`);
    root.style.setProperty('--kb-h', `${metrics.keyboardHeight}px`);
  };

  const updateAfterRotation = () => {
    // Единственный случай, когда окно честно становится больше: запомненную
    // высоту сбрасываем, иначе в альбомной ориентации осталась бы портретная
    appHeight = 0;
    update();
    window.clearTimeout(settleTimer);
    settleTimer = window.setTimeout(update, ORIENTATION_SETTLE_MS);
  };

  update();

  window.addEventListener('resize', update);
  window.addEventListener('orientationchange', updateAfterRotation);
  // Скролл visualViewport — это когда iOS сдвигает видимую область, подводя
  // поле ввода к клавиатуре: высота та же, а offsetTop уже другой
  window.visualViewport?.addEventListener('resize', update);
  window.visualViewport?.addEventListener('scroll', update);

  return () => {
    window.clearTimeout(settleTimer);
    window.removeEventListener('resize', update);
    window.removeEventListener('orientationchange', updateAfterRotation);
    window.visualViewport?.removeEventListener('resize', update);
    window.visualViewport?.removeEventListener('scroll', update);
  };
}
