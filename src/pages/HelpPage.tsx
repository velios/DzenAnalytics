import { useState } from "react";
import {
  HelpCircle,
  ChevronDown,
  ChevronRight,
  Settings2,
  Flame,
  Zap,
  Repeat,
  Lock,
  Hash,
  Database,
  Percent,
  Filter,
  Bookmark,
  Search,
  Camera,
  Target,
  Keyboard,
  Wand2,
  HeartPulse,
  FlaskConical,
  Newspaper,
  Sparkles,
  LayoutDashboard,
  LineChart,
  PieChart,
  Activity,
  Wallet,
  CalendarDays,
  GitFork,
  Copy,
  Tag,
  Cloud,
  GitCompare,
  TrendingUp,
  Upload,
  Coins,
  Users,
} from "lucide-react";

type Group = "main" | "more" | "concepts";

interface Section {
  id: string;
  group: Group;
  icon: typeof HelpCircle;
  title: string;
  body: React.ReactNode;
}

const GROUP_LABEL: Record<Group, string> = {
  main: "Меню «Основное»",
  more: "Меню «Ещё»",
  concepts: "Концепции и фишки",
};

const SECTIONS: Section[] = [
  // ============================================================
  // Меню «Основное»
  // ============================================================
  {
    id: "page-dashboard",
    group: "main",
    icon: LayoutDashboard,
    title: "Главная",
    body: (
      <>
        <p>
          Обзорный дашборд — всё важное на одном экране, без фильтров. Открывается по
          умолчанию при входе.
        </p>
        <ul className="list-disc list-inside space-y-1 mt-2">
          <li>
            <strong>4 hero-KPI</strong>: совокупный баланс (с учётом калибровки), доход и
            расход за последний месяц с дельтой к предыдущему, норма сбережений.
          </li>
          <li>
            <strong>Cash-flow с прогнозом</strong> — бары income/expense + линия net и
            прогноз на 3 месяца вперёд (среднее за последние 6 мес).
          </li>
          <li>
            <strong>Совокупный баланс</strong> — area-чарт нарастающего net worth.
          </li>
          <li>
            <strong>Авто-инсайты</strong> — топ-6 наблюдений: самая крупная трата месяца,
            заметные MoM-сдвиги, рост категорий и т.п.
          </li>
          <li>
            <strong>Топ-7 категорий</strong> с прогресс-барами, <strong>топ-5 самых
            крупных операций</strong>, ближайшие регулярные платежи.
          </li>
          <li>
            <strong>Mini-heatmap</strong> активности за 90 дней (GitHub-style).
          </li>
          <li>
            <strong>Структура расходов</strong> — фиксированные/дискретные/без флага +
            KPI «свободные деньги».
          </li>
          <li>
            <strong>Снимок PNG</strong> — экспортирует весь дашборд одним файлом
            (pixelRatio 2× для retina).
          </li>
        </ul>
        <p className="mt-2 text-muted text-xs">
          Если на Главной баннер «Калибровка» — рекомендуем сразу её сделать, иначе
          совокупный баланс будет от нуля (см. раздел «Калибровка» ниже).
        </p>
      </>
    ),
  },
  {
    id: "page-cashflow",
    group: "main",
    icon: LineChart,
    title: "Cash-flow",
    body: (
      <>
        <p>
          Глубокая аналитика доходов и расходов помесячно. Поддерживает глобальные
          фильтры (период, счета, категории).
        </p>
        <ul className="list-disc list-inside space-y-1 mt-2">
          <li>
            <strong>Месячные бары</strong> доходов/расходов и линия чистого потока.
          </li>
          <li>
            <strong>Прогноз 3 сценария</strong> на ближайшие месяцы:
            оптимист/реалист/пессимист. База — скользящее среднее последних 6 мес.
          </li>
          <li>
            <strong>Год к году</strong> — сравнение текущего YTD с прошлым.
          </li>
          <li>
            <strong>Waterfall за месяц</strong> — баланс начала → доходы → топ-8 категорий
            расходов → баланс конца. Можно листать месяцы.
          </li>
          <li>
            <strong>Stream graph</strong> — поток top-10 категорий по месяцам.
          </li>
          <li>
            <strong>Сезонность</strong> — средний расход по месяцам года с цветовым
            отклонением (бывает виден отопительный сезон, новогодние траты и т.п.).
          </li>
          <li>
            Вертикальные линии-<strong>аннотации</strong> и средняя линия за период.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: "page-categories",
    group: "main",
    icon: PieChart,
    title: "Категории",
    body: (
      <>
        <p>
          Структура расходов сразу в трёх видах: donut-чарт, treemap, bar-chart.
          Иерархия категорий с раскрытием подкатегорий.
        </p>
        <p className="mt-2">
          У каждой категории — кликабельный <strong>флаг</strong> 🔒/☕/○
          (фиксированная/дискретная/без флага). См. раздел «Флаги категорий» ниже —
          они нужны для KPI «свободные деньги» на Главной.
        </p>
        <p className="mt-2 text-muted text-xs">
          Клик по любому сегменту / строке открывает drawer с операциями этой категории.
        </p>
      </>
    ),
  },
  {
    id: "page-trends",
    group: "main",
    icon: Activity,
    title: "Тренды",
    body: (
      <>
        <p>Паттерны трат во времени и по дням недели.</p>
        <ul className="list-disc list-inside space-y-1 mt-2">
          <li>Помесячный таймлайн по категориям</li>
          <li>Bar-chart по дням недели</li>
          <li>Radar-диаграмма категорий</li>
          <li>Heatmap «час недели» (24 часа × 7 дней) — видны привычки</li>
          <li>KPI «будни vs выходные» — сколько тратится в эти периоды</li>
        </ul>
      </>
    ),
  },
  {
    id: "page-goals",
    group: "main",
    icon: Target,
    title: "Цели + FIRE",
    body: (
      <>
        <p>
          <strong>Цели</strong> — копить на конкретное (машина, отпуск, подушка
          безопасности). Прогресс-бар, расчёт срока достижения исходя из текущей нормы
          сбережений.
        </p>
        <p className="mt-2">
          <strong>Блок FIRE</strong> — финансовая независимость:
        </p>
        <ul className="list-disc list-inside space-y-1 mt-1">
          <li>Текущая норма сбережений</li>
          <li>«Магическое число» = годовой расход × 25 (правило 4%)</li>
          <li>Лет до FIRE при текущем темпе</li>
          <li>Сценарии 10/20/30/50% — что будет, если откладывать больше</li>
        </ul>
        <p className="mt-2 text-muted text-xs">
          Подробнее про логику расчёта — раздел «FIRE» ниже.
        </p>
      </>
    ),
  },

  // ============================================================
  // Меню «Ещё»
  // ============================================================
  {
    id: "page-health",
    group: "more",
    icon: HeartPulse,
    title: "Здоровье",
    body: (
      <>
        <p>
          Единый интегральный показатель 0–100 + буквенная оценка (A+/A/B/…/E)
          на основе 5 метрик:
        </p>
        <ul className="list-disc list-inside space-y-1 mt-2">
          <li>
            <strong>Норма сбережений</strong> (вес 30%) — среднее за 6 месяцев,
            цель ≥ 20%
          </li>
          <li>
            <strong>Подушка безопасности</strong> (25%) — совокупный баланс /
            средний месячный расход, цель ≥ 6 мес
          </li>
          <li>
            <strong>Чистота категоризации</strong> (15%) — % операций без
            категории, цель ≤ 5%
          </li>
          <li>
            <strong>Стабильность сбережений</strong> (15%) — насколько ровно
            откладываете из месяца в месяц (CV нормы сбережений)
          </li>
          <li>
            <strong>Доля фиксированных в доходе</strong> (15%) — нужно
            проставить флаги 🔒 на странице «Категории», иначе N/A
          </li>
        </ul>
        <p className="mt-2 text-muted text-xs">
          К каждому компоненту есть подсказка, что подкрутить, если балл низкий.
          Метрики с состоянием «нет данных» исключаются и веса
          пересчитываются.
        </p>
      </>
    ),
  },
  {
    id: "page-whatif",
    group: "more",
    icon: FlaskConical,
    title: "Что-если",
    body: (
      <>
        <p>
          Слайдеры, которые в реальном времени пересчитывают ваше финансовое
          будущее:
        </p>
        <ul className="list-disc list-inside space-y-1 mt-2">
          <li>Множитель дохода (0.5×–2×) — модель прибавки или сокращения</li>
          <li>Множитель расхода (0.5×–1.5×) — общий «затянуть пояс»</li>
          <li>Дополнительная сумма «отложить в месяц» — фиксированная дельта</li>
          <li>Стартовый капитал — по умолчанию текущий совокупный баланс</li>
          <li>
            Множители на топ-8 категорий — точечные сокращения вроде «убрать
            рестораны на 50%»
          </li>
        </ul>
        <p className="mt-2">
          Результат: новая норма сбережений, годовая экономия, лет до FIRE
          (с дельтой к текущей траектории), прогноз капитала через 1 / 5 / 10
          лет.
        </p>
      </>
    ),
  },
  {
    id: "page-year-review",
    group: "more",
    icon: Sparkles,
    title: "Год в цифрах",
    body: (
      <>
        <p>
          Сводный отчёт за выбранный год в стиле «итоги года»: суммарный доход,
          расход, чистый поток с дельтами к прошлому году, рекордные месяцы
          (лучший / самый расходный / рекорд по доходу), топ-8 категорий и
          получателей с прогресс-барами, топ-5 самых дорогих покупок и блок
          «любопытные факты»: средний расход в день, любимый день недели,
          самая длинная серия дней без трат, число уникальных получателей и
          категорий.
        </p>
        <p className="mt-2 text-muted text-xs">
          Селектор года переключает между всеми годами с данными. Кнопка
          «Снимок PNG» экспортирует весь отчёт одним файлом для шеринга.
        </p>
      </>
    ),
  },
  {
    id: "page-digest",
    group: "more",
    icon: Newspaper,
    title: "Дайджест",
    body: (
      <>
        <p>
          Авто-сгенерированные итоги по неделям (последние 26) и месяцам со
          сравнением каждого периода с предыдущим. Что внутри каждого
          дайджеста:
        </p>
        <ul className="list-disc list-inside space-y-1 mt-2">
          <li>
            Доход / расход / чистый поток с дельтами к прошлому такому же
            периоду
          </li>
          <li>
            <strong>«Где выстрелило»</strong> — категории с наибольшими
            абсолютными изменениями (рост или падение)
          </li>
          <li>Топ-5 самых дорогих операций периода</li>
        </ul>
        <p className="mt-2 text-muted text-xs">
          Переключатель «По месяцам / По неделям» наверху; список периодов
          слева, детали справа.
        </p>
      </>
    ),
  },
  {
    id: "page-budgets",
    group: "more",
    icon: Target,
    title: "Бюджеты",
    body: (
      <p>
        Месячные лимиты по категориям с цветным прогрессом
        (зелёный/жёлтый/красный), маркером прогресса месяца и прогнозом перерасхода
        при текущем темпе. Лимиты редактируются прямо на странице.
      </p>
    ),
  },
  {
    id: "page-accounts",
    group: "more",
    icon: Wallet,
    title: "Счета",
    body: (
      <>
        <p>
          Структура капитала по счетам. Stacked-area-чарт по топ-8 счетам, общая линия
          совокупного баланса, sparkline на карточке каждого из ~28 счетов, drill-down
          в любой счёт.
        </p>
        <p className="mt-2">
          Здесь же — <strong>панель калибровки</strong> совокупного баланса (см. раздел
          «Калибровка»).
        </p>
      </>
    ),
  },
  {
    id: "page-calendar",
    group: "more",
    icon: CalendarDays,
    title: "Календарь",
    body: (
      <p>
        GitHub-style тепловая карта по дням всего года, 9 градаций цвета (квантильное
        распределение, чтобы не «съедал» ярко-окрашенные дни). Переключатель
        год/расходы-доходы. Клик по дню — drawer с операциями.
      </p>
    ),
  },
  {
    id: "page-sankey",
    group: "more",
    icon: GitFork,
    title: "Потоки",
    body: (
      <p>
        Sankey-диаграмма: источники доходов → суммарный бюджет → категории расходов.
        Толщина потока пропорциональна сумме. Наглядно показывает, куда «утекают»
        деньги от какого источника.
      </p>
    ),
  },
  {
    id: "page-anomalies",
    group: "more",
    icon: Zap,
    title: "Аномалии",
    body: (
      <p>
        Подсветка операций-выбросов и резких всплесков по категориям. Подробное
        объяснение алгоритма — раздел «Сигма (σ) в аномалиях» ниже.
      </p>
    ),
  },
  {
    id: "page-duplicates",
    group: "more",
    icon: Copy,
    title: "Дубликаты",
    body: (
      <p>
        Авто-детект подозрительно похожих операций: <em>одинаковая сумма + получатель
        + тип в окне 1–14 дней</em>. Помогает почистить случайно созданные дубли в
        Дзен-мани.
      </p>
    ),
  },
  {
    id: "page-uncategorized",
    group: "more",
    icon: Tag,
    title: "Без категории",
    body: (
      <>
        <p>
          Операции с пустой категорией или «Прочие» — подсветка пробелов для чистки в
          Дзен-мани.
        </p>
        <p className="mt-2">
          <strong>Smart suggestions:</strong> алгоритм находит похожие операции с
          известной категорией (по получателю + комментарию) и предлагает создать
          правило одним кликом. Кнопка «Применить уверенные» создаёт сразу все правила
          с confidence ≥ 70%.
        </p>
      </>
    ),
  },
  {
    id: "page-recurring",
    group: "more",
    icon: Repeat,
    title: "Регулярные",
    body: (
      <p>
        Авто-детект подписок и регулярных трат + прогноз ближайших платежей + общая
        месячная нагрузка. Подробности алгоритма — раздел «Авто-детект регулярных»
        ниже.
      </p>
    ),
  },
  {
    id: "page-annotations",
    group: "more",
    icon: Bookmark,
    title: "Аннотации",
    body: (
      <p>
        Заметки на временной шкале. «Зарплата выросла», «Купил машину», «Поменяли
        квартиру» — отображаются вертикальной линией на графиках Cash-flow и
        Совокупного баланса. Помогают объяснить заметные сдвиги.
      </p>
    ),
  },
  {
    id: "page-tags",
    group: "more",
    icon: Hash,
    title: "Хэштеги",
    body: (
      <p>
        Если в комментариях к операциям пишете теги вида <code>#Mazda3</code>,{" "}
        <code>#Катя</code>, <code>#Картино</code> — DzenAnalytics извлекает их и
        группирует операции по тегам. Облако тегов + таблица с суммами и drill-down.
        Подробнее — раздел «Хэштеги в комментариях» ниже.
      </p>
    ),
  },
  {
    id: "page-wordcloud",
    group: "more",
    icon: Cloud,
    title: "Облако слов",
    body: (
      <p>
        Самые частые слова в комментариях. Размер — частота, цвет — для чтения,
        стоп-слова отфильтрованы. Клик по слову — все операции, где оно встречается.
        Полезно увидеть, что вы реально «покупаете» помимо категорий.
      </p>
    ),
  },
  {
    id: "page-compare",
    group: "more",
    icon: GitCompare,
    title: "Сравнение",
    body: (
      <p>
        Сравнить два периода. Пресеты: текущий месяц / предыдущий, YTD vs прошлый YTD,
        30/30, 90/90 — либо произвольные даты. Дельты со стрелками, bar-chart по
        категориям. Удобно, чтобы понять «стал ли я тратить больше».
      </p>
    ),
  },
  {
    id: "page-top",
    group: "more",
    icon: TrendingUp,
    title: "Топ",
    body: (
      <p>
        Три сортируемые таблицы: топ-категории, топ-получатели, топ-операции. Все
        строки кликабельны — открывают drawer с детализацией. На любой странице с
        таблицей есть кнопка «CSV» (экспорт текущей сортировки).
      </p>
    ),
  },
  {
    id: "page-rules",
    group: "more",
    icon: Wand2,
    title: "Правила",
    body: (
      <p>
        Управление правилами перезаписи категорий. Подробности — раздел «Правила
        категоризации» ниже.
      </p>
    ),
  },
  {
    id: "page-help",
    group: "more",
    icon: HelpCircle,
    title: "Справка",
    body: <p>Этот документ.</p>,
  },
  {
    id: "page-import",
    group: "more",
    icon: Upload,
    title: "Импорт",
    body: (
      <>
        <p>
          Главная страница настроек — несмотря на название. Здесь:
        </p>
        <ul className="list-disc list-inside space-y-1 mt-2">
          <li>
            <strong>Загрузка CSV-выгрузки</strong> Дзен-мани (drag-and-drop или клик).
            Два режима: «Заменить» (стереть и загрузить) и «Дополнить» (дедуп по{" "}
            <code>id</code>, добавить только новое).
          </li>
          <li>
            <strong>Базовая валюта</strong> и таблица курсов — см. раздел «Базовая
            валюта и курсы» ниже.
          </li>
          <li>
            <strong>Поправка на инфляцию</strong> — см. соответствующий раздел.
          </li>
          <li>
            <strong>Группировка похожих получателей</strong> (Магнит / Магнит #1234 /
            MAGNIT-MOSCOW → один payee) — переключатель.
          </li>
          <li>
            <strong>Backup / Restore</strong> — экспорт всей базы в JSON и обратно.
          </li>
          <li>Превью последних 10 импортированных операций.</li>
        </ul>
      </>
    ),
  },

  // ============================================================
  // Концепции и фишки
  // ============================================================
  {
    id: "concept-calibration",
    group: "concepts",
    icon: Settings2,
    title: "Калибровка совокупного баланса",
    body: (
      <>
        <p>
          CSV-выгрузка Дзен-мани <strong>не содержит начальных остатков</strong> ваших
          счетов — только последовательность операций. Поэтому без калибровки график
          «Совокупный баланс» = <code>сумма доходов − сумма расходов</code> от первой
          записи в файле, а не реальный остаток.
        </p>
        <p className="mt-2">
          <strong>Решение:</strong> ввести вашу <em>текущую</em> сумму на всех счетах
          (через баннер на Главной или панель на Счетах). График сдвинется на разницу,
          и любая прошлая точка покажет реальное значение.
        </p>
        <p className="mt-2 text-muted text-xs">
          Пример: если у вас сейчас 2 900 000 ₽, а график показывает −1 200 000 ₽ на ту
          же дату, сдвиг = +4 100 000 ₽. До первой операции в выгрузке у вас было
          ~4.1 млн — эта сумма скрыта в файле, калибровка её восстанавливает.
        </p>
        <p className="mt-2 text-muted text-xs">
          Калибровка влияет только на чарт «Совокупно (одной линией)» и связанные KPI.
          Stacked-чарт «По счетам» и индивидуальные карточки счетов остаются «от 0» —
          для них нужны были бы остатки <em>каждого</em> счёта по отдельности.
        </p>
      </>
    ),
  },
  {
    id: "concept-base-currency",
    group: "concepts",
    icon: Coins,
    title: "Базовая валюта и курсы",
    body: (
      <>
        <p>
          DzenAnalytics сводит все операции в <strong>одну базовую валюту</strong> —
          KPI и графики всегда показываются в ней. По умолчанию это <code>RUB</code>,
          но на странице «Импорт» можно переключить на любую другую из списка (USD,
          EUR, GBP, CNY, JPY, KZT, BYN, GEL, AMD, AED, TRY, THB).
        </p>
        <p className="mt-2">
          <strong>Что происходит при смене базы:</strong> курсы всех валют автоматически
          пересчитываются относительно новой базы (математически re-anchor:{" "}
          <code>new[X] = old[X] / old[НоваяБаза]</code>), все суммы транзакций
          пересчитываются в новой базе. Если у новой базы курс был ноль или отсутствует
          — переключение блокируется с подсказкой.
        </p>
        <p className="mt-2 text-muted text-xs">
          Курсы — редактируемая таблица «1 X = N база». Меняйте под актуальный
          среднегодовой курс или ваш курс обмена. Все агрегации пересчитываются на лету.
        </p>
        <p className="mt-2 text-muted text-xs">
          Если в импортируемом CSV встретится валюта, которой нет в таблице — она
          добавится автоматически со значением 1; вам останется выставить нужный курс.
        </p>
      </>
    ),
  },
  {
    id: "concept-fire",
    group: "concepts",
    icon: Flame,
    title: "FIRE — финансовая независимость",
    body: (
      <>
        <p>
          <strong>FIRE</strong> = Financial Independence, Retire Early. Идея простая:
          когда ваш капитал даёт пассивный доход, покрывающий расходы, работать ради
          денег уже не обязательно.
        </p>
        <p className="mt-2">
          <strong>Magic number = годовой расход × 25</strong> — основано на «правиле
          4%» (исследование Бенгена, Trinity Study): портфель из акций/облигаций
          среднестатистически выдерживает изъятие 4% в год без истощения за 30+ лет.
        </p>
        <p className="mt-2">
          <strong>Лет до FIRE</strong> вычисляется как:
          <code className="block bg-panel2 p-2 rounded mt-1 text-xs">
            (Magic number − Текущий капитал) / (Норма сбережений × 12 × Доход)
          </code>
        </p>
        <p className="mt-2 text-muted text-xs">
          Сценарии 10/20/30/50% показывают, как срок меняется при разной дисциплине
          сбережений. Расчёт оптимистичен — не учитывает доходность инвестиций (только
          накопление). Реальные сроки обычно короче за счёт сложного процента.
        </p>
      </>
    ),
  },
  {
    id: "concept-sigma",
    group: "concepts",
    icon: Zap,
    title: "Сигма (σ) в аномалиях",
    body: (
      <>
        <p>
          Раздел «Аномалии» ищет операции-выбросы по двум критериям:
        </p>
        <ul className="list-disc list-inside space-y-1 mt-2">
          <li>
            <strong>Выбросы по категории/получателю</strong>: z-score &gt; 2.5σ.
            То есть операция отличается от среднего по этой категории/получателю
            больше, чем на 2.5 стандартных отклонения.
          </li>
          <li>
            <strong>Всплески по категориям (MoM)</strong>: категория выросла в 1.5×+
            к среднему за 3 предыдущих месяца.
          </li>
        </ul>
        <p className="mt-2 text-muted text-xs">
          Чувствительность регулируется ползунком 2.0–4.0σ. Чем меньше σ — тем больше
          операций попадут в выбросы. 2.5σ — компромисс: ловит реально странные
          операции, не зашумляет рутиной.
        </p>
        <p className="mt-2 text-muted text-xs">
          Минимум 5 операций по категории/получателю должно быть, иначе σ нерелевантна.
        </p>
      </>
    ),
  },
  {
    id: "concept-recurring",
    group: "concepts",
    icon: Repeat,
    title: "Авто-детект регулярных платежей",
    body: (
      <>
        <p>
          На странице «Регулярные» алгоритм находит подписки и регулярные траты по
          сигнатуре «получатель + валюта». Условия попадания:
        </p>
        <ul className="list-disc list-inside space-y-1 mt-2">
          <li>Минимум 3 повторения</li>
          <li>Средний интервал между ними — от 5 до 95 дней</li>
          <li>Coefficient of Variation (CV) суммы и интервала — не выше 0.7</li>
          <li>Покрыто минимум 2 разных календарных месяца</li>
        </ul>
        <p className="mt-2 text-muted text-xs">
          <strong>Стабильность</strong> = <code>1 − cv_amount/2 − cv_interval/2</code>.
          Чем выше — тем стабильнее платёж. Например, Spotify за 169 ₽ ровно каждые
          30 дней даст ~95%, а нерегулярная аренда с разными суммами — 50–70%.
        </p>
        <p className="mt-2 text-muted text-xs">
          <strong>Прогноз ближайших</strong> = <code>last_date + средний интервал</code>.
          Грубо, но обычно попадает в неделю.
        </p>
      </>
    ),
  },
  {
    id: "concept-flags",
    group: "concepts",
    icon: Lock,
    title: "Флаги категорий: фиксированные vs дискретные",
    body: (
      <>
        <p>
          На странице «Категории» рядом с каждой категорией есть кликабельная иконка-
          флаг:
        </p>
        <ul className="list-disc list-inside space-y-1 mt-2">
          <li>🔒 <strong>Фиксированная</strong> — обязательная (квартира, машина, продукты)</li>
          <li>☕ <strong>Дискретная</strong> — необязательная (рестораны, развлечения, импульсы)</li>
          <li>○ <strong>Без флага</strong> — нейтрально</li>
        </ul>
        <p className="mt-2">
          Клик по иконке циклит состояния. На Главной появляется блок «Структура
          расходов» и KPI <strong>«Свободные деньги»</strong> = доход − фиксированные
          расходы. Это самый честный показатель того, сколько денег вы реально
          «решаете куда направить» каждый месяц.
        </p>
      </>
    ),
  },
  {
    id: "concept-hashtags",
    group: "concepts",
    icon: Hash,
    title: "Хэштеги в комментариях",
    body: (
      <>
        <p>
          Если в комментариях к операциям вы пишете теги вида <code>#Mazda3</code>,{" "}
          <code>#Катя</code>, <code>#Картино</code> — DzenAnalytics автоматически
          извлекает их и группирует операции по тегам на странице «Хэштеги».
        </p>
        <p className="mt-2 text-muted text-xs">
          Полезно для срезов, не вписывающихся в плоскую категоризацию: проект,
          поездка, член семьи, машина. Тег = словесный токен после <code>#</code>,
          поддерживаются русские буквы и цифры.
        </p>
      </>
    ),
  },
  {
    id: "concept-rules",
    group: "concepts",
    icon: Wand2,
    title: "Правила категоризации",
    body: (
      <>
        <p>
          На странице «Правила» можно задать перезапись категории: например, «если
          получатель содержит <em>Магнит</em>, то категория = Еда дома».
        </p>
        <p className="mt-2">
          <strong>Поля:</strong> <code>payee</code> / <code>comment</code> /{" "}
          <code>category</code>. <strong>Операции:</strong> <code>contains</code> /{" "}
          <code>equals</code> / <code>starts_with</code> / <code>regex</code>. Можно
          включить case-insensitive.
        </p>
        <p className="mt-2 text-muted text-xs">
          Правила применяются <em>при загрузке транзакций</em>, оригинальная категория
          сохраняется в <code>categoryOriginal</code> и восстанавливается при
          отключении правила. Порядок имеет значение: применяется первое подошедшее
          правило (можно двигать стрелками).
        </p>
        <p className="mt-2 text-muted text-xs">
          Также правила автоматически создаются со страницы «Без категории» через
          smart suggestions — это самый быстрый способ заполнить пробелы.
        </p>
      </>
    ),
  },
  {
    id: "concept-filters",
    group: "concepts",
    icon: Filter,
    title: "Глобальные фильтры",
    body: (
      <>
        <p>
          Панель фильтров наверху аналитических страниц задаёт период, счета,
          категории, валюты, поиск и флаг «без переводов». Стрелки{" "}
          <code>← Месяц →</code> — пошаговая навигация: переключаются в режим «Месяц»
          и листают вперёд/назад в пределах данных.
        </p>
        <p className="mt-2 text-muted text-xs">
          Фильтры действуют на: Cash-flow, Категории, Счета, Тренды, Календарь, Топ,
          Хэштеги, Sankey, Облако слов. На Главной, Импорте, Сравнении, Регулярных,
          Аномалиях, Дубликатах, Без категории, Аннотациях, Целях, Бюджетах — нет (там
          своя логика времени).
        </p>
      </>
    ),
  },
  {
    id: "concept-saved-views",
    group: "concepts",
    icon: Bookmark,
    title: "Сохранённые виды (Saved Views)",
    body: (
      <p>
        Кнопки «Виды» и «Сохранить» в фильтрах. Сохраняют полную комбинацию (период +
        счета + категории + валюты + поиск + флаг переводов) под именем. Применить —
        один клик. Хранятся в IndexedDB вместе с остальными данными.
      </p>
    ),
  },
  {
    id: "concept-search",
    group: "concepts",
    icon: Search,
    title: "Глобальный поиск",
    body: (
      <>
        <p>
          Полнотекст по получателю, комментарию, категории и счёту. Несколько слов
          через пробел — все должны встречаться (AND). Поле «исключить» — наоборот,
          исключает совпадения. Опциональный regex (регистронезависимый).
        </p>
        <p className="mt-2 text-muted text-xs">
          Дополнительно: фильтры по диапазону сумм и дат, тип (расход/доход).
          Результаты можно открыть пакетно в drawer'е через «Открыть всё».
        </p>
      </>
    ),
  },
  {
    id: "concept-palette-shortcuts",
    group: "concepts",
    icon: Keyboard,
    title: "Командная палитра и горячие клавиши",
    body: (
      <>
        <p>
          <strong>Командная палитра</strong> (<kbd className="kbd">Ctrl/⌘+K</kbd> или{" "}
          <kbd className="kbd">/</kbd>) — fuzzy-поиск по всему: страницы, категории,
          получатели, месяцы, сохранённые виды. Запускает действия (смена темы, сброс
          фильтров). Навигация <kbd className="kbd">↑↓</kbd>,{" "}
          <kbd className="kbd">Enter</kbd>, <kbd className="kbd">Esc</kbd>.
        </p>
        <table className="w-full text-sm mt-3">
          <tbody>
            <tr className="border-b border-border">
              <td className="py-2"><kbd className="kbd">Ctrl/⌘ + K</kbd></td>
              <td className="py-2 text-muted">Командная палитра</td>
            </tr>
            <tr className="border-b border-border">
              <td className="py-2"><kbd className="kbd">/</kbd></td>
              <td className="py-2 text-muted">Открыть палитру</td>
            </tr>
            <tr className="border-b border-border">
              <td className="py-2"><kbd className="kbd">Esc</kbd></td>
              <td className="py-2 text-muted">Закрыть drawer / палитру</td>
            </tr>
            <tr className="border-b border-border">
              <td className="py-2"><kbd className="kbd">g</kbd> <kbd className="kbd">d</kbd></td>
              <td className="py-2 text-muted">Перейти на Главную</td>
            </tr>
            <tr className="border-b border-border">
              <td className="py-2"><kbd className="kbd">g</kbd> <kbd className="kbd">c</kbd></td>
              <td className="py-2 text-muted">Cash-flow</td>
            </tr>
            <tr className="border-b border-border">
              <td className="py-2"><kbd className="kbd">g</kbd> <kbd className="kbd">k</kbd></td>
              <td className="py-2 text-muted">Категории</td>
            </tr>
            <tr className="border-b border-border">
              <td className="py-2"><kbd className="kbd">g</kbd> <kbd className="kbd">a</kbd></td>
              <td className="py-2 text-muted">Счета</td>
            </tr>
            <tr className="border-b border-border">
              <td className="py-2"><kbd className="kbd">g</kbd> <kbd className="kbd">t</kbd></td>
              <td className="py-2 text-muted">Тренды</td>
            </tr>
            <tr className="border-b border-border">
              <td className="py-2"><kbd className="kbd">g</kbd> <kbd className="kbd">b</kbd></td>
              <td className="py-2 text-muted">Бюджеты</td>
            </tr>
            <tr className="border-b border-border">
              <td className="py-2"><kbd className="kbd">g</kbd> <kbd className="kbd">s</kbd></td>
              <td className="py-2 text-muted">Поиск</td>
            </tr>
            <tr>
              <td className="py-2"><kbd className="kbd">g</kbd> <kbd className="kbd">h</kbd></td>
              <td className="py-2 text-muted">Справка</td>
            </tr>
          </tbody>
        </table>
      </>
    ),
  },
  {
    id: "concept-backup",
    group: "concepts",
    icon: Database,
    title: "Backup / Restore",
    body: (
      <>
        <p>
          На странице «Импорт» — экспорт всей базы в JSON и импорт обратно. Включает
          транзакции, бюджеты, цели, калибровку, виды, аннотации, флаги категорий,
          инфляцию, правила, настройку группировки получателей.
        </p>
        <p className="mt-2 text-muted text-xs">
          Используйте перед очисткой Application Storage браузера или для переноса
          между устройствами. Файл — единственный надёжный способ переноса, потому что
          IndexedDB привязана к origin'у (домену / пути к HTML-файлу).
        </p>
      </>
    ),
  },
  {
    id: "concept-payee-grouping",
    group: "concepts",
    icon: Users,
    title: "Группировка похожих получателей",
    body: (
      <p>
        На странице «Импорт» — переключатель «Группировка похожих получателей». Когда
        включено: <code>Магнит</code>, <code>Магнит #1234</code>,{" "}
        <code>MAGNIT-MOSCOW</code> сводятся к одному payee. Полезно для топов и
        регулярных платежей. Группировка обратимая, оригинальные имена сохраняются.
      </p>
    ),
  },
  {
    id: "concept-inflation",
    group: "concepts",
    icon: Percent,
    title: "Поправка на инфляцию",
    body: (
      <>
        <p>
          На странице «Импорт» — переключатель «Поправка на инфляцию». При включении
          все суммы пересчитываются в реальные деньги <strong>базового года</strong>.
          Расход в 2022-м умножается на накопленную инфляцию до базового года.
          Полезно для честного сравнения трат за разные годы.
        </p>
        <p className="mt-2 text-muted text-xs">
          Ставки CPI редактируются. Дефолтные — приближённые к Росстату, можно
          заменить на свои.
        </p>
      </>
    ),
  },
  {
    id: "concept-themes",
    group: "concepts",
    icon: Camera,
    title: "Темы и снимок дашборда",
    body: (
      <>
        <p>
          Переключатель тем в правом верхнем углу: Светлая (по умолчанию) / Тёмная /{" "}
          <strong>Авто</strong> (<code>prefers-color-scheme</code> системы + по часам:
          20:00–07:00 → тёмная). Выбор сохраняется.
        </p>
        <p className="mt-2">
          Кнопка «Снимок PNG» на Главной экспортирует весь дашборд (со всеми KPI,
          графиками и виджетами) в PNG-файл с pixelRatio 2× для retina-дисплеев.
          Кнопки калибровки и баннеры в снимок не попадают.
        </p>
      </>
    ),
  },
];

export function HelpPage() {
  const [open, setOpen] = useState<Set<string>>(new Set([SECTIONS[0].id]));

  function toggle(id: string) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const groups: Group[] = ["main", "more", "concepts"];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <HelpCircle className="w-6 h-6 text-accent" />
          Справка
        </h1>
        <p className="text-muted text-sm mt-1">
          Полный путеводитель по DzenAnalytics: каждый пункт меню — что это, для чего
          и как работает; ниже — сквозные концепции (калибровка, FIRE, σ, правила и
          т.п.). Кликайте по разделам, чтобы раскрыть.
        </p>
      </div>

      {groups.map((g) => {
        const items = SECTIONS.filter((s) => s.group === g);
        if (items.length === 0) return null;
        return (
          <div key={g} className="space-y-2">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted px-1">
              {GROUP_LABEL[g]}
            </h2>
            <div className="card card-pad space-y-1">
              {items.map((s) => {
                const isOpen = open.has(s.id);
                const Icon = s.icon;
                return (
                  <div key={s.id} className="border-b border-border last:border-b-0">
                    <button
                      onClick={() => toggle(s.id)}
                      className="w-full flex items-center gap-3 py-3 text-left hover:bg-panel2/40 px-2 -mx-2 rounded transition-colors"
                    >
                      {isOpen ? (
                        <ChevronDown className="w-4 h-4 text-muted shrink-0" />
                      ) : (
                        <ChevronRight className="w-4 h-4 text-muted shrink-0" />
                      )}
                      <Icon className="w-4 h-4 text-accent2 shrink-0" />
                      <span className="font-medium">{s.title}</span>
                    </button>
                    {isOpen && (
                      <div className="pb-4 pl-9 pr-2 text-sm text-text leading-relaxed">
                        {s.body}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
