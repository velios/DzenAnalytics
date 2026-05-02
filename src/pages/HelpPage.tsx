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
} from "lucide-react";

interface Section {
  id: string;
  icon: typeof HelpCircle;
  title: string;
  body: React.ReactNode;
}

const SECTIONS: Section[] = [
  {
    id: "calibration",
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
          Stacked-чарт «По счетам» и индивидуальные карточки счетов остаются «от 0» — для
          них нужны были бы остатки <em>каждого</em> счёта по отдельности.
        </p>
      </>
    ),
  },
  {
    id: "fire",
    icon: Flame,
    title: "FIRE — финансовая независимость",
    body: (
      <>
        <p>
          <strong>FIRE</strong> = Financial Independence, Retire Early. Идея простая: когда
          ваш капитал даёт пассивный доход, покрывающий расходы, работать ради денег уже
          не обязательно.
        </p>
        <p className="mt-2">
          <strong>Magic number = годовой расход × 25</strong> — основано на «правиле 4%»
          (исследование Бенгена, Trinity Study): портфель из акций/облигаций
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
    id: "anomalies",
    icon: Zap,
    title: "Аномалии и σ (сигма)",
    body: (
      <>
        <p>
          Раздел «Аномалии» ищет операции-выбросы по двум критериям:
        </p>
        <ul className="list-disc list-inside space-y-1 mt-2">
          <li>
            <strong>Выбросы по категории/получателю</strong>: z-score &gt; 2.5σ.
            То есть операция отличается от среднего по этой категории/получателю на
            больше, чем 2.5 стандартных отклонения.
          </li>
          <li>
            <strong>Всплески по категориям (MoM)</strong>: категория выросла в 1.5×+
            к среднему за 3 предыдущих месяца.
          </li>
        </ul>
        <p className="mt-2 text-muted text-xs">
          Чувствительность регулируется ползунком 2.0–4.0σ. Чем меньше σ — тем больше
          операций попадут в выбросы. 2.5σ — компромисс: ловит реально странные операции,
          не зашумляет рутиной.
        </p>
        <p className="mt-2 text-muted text-xs">
          Минимум 5 операций по категории/получателю должно быть, иначе σ нерелевантна.
        </p>
      </>
    ),
  },
  {
    id: "recurring",
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
          <strong>Стабильность</strong> = `1 - cv_amount/2 - cv_interval/2`. Чем выше —
          тем стабильнее платёж. Например, Spotify за 169 ₽ ровно каждые 30 дней даст
          ~95%, а нерегулярная аренда с разными суммами — 50–70%.
        </p>
        <p className="mt-2 text-muted text-xs">
          <strong>Прогноз ближайших</strong> = <code>last_date + средний интервал</code>.
          Грубо, но обычно попадает в неделю.
        </p>
      </>
    ),
  },
  {
    id: "flags",
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
          Клик по иконке циклит состояния. На Главной появляется блок «Структура расходов»
          и KPI <strong>«Свободные деньги»</strong> = доход − фиксированные расходы.
          Это самый честный показатель того, сколько денег вы реально «решаете куда
          направить» каждый месяц.
        </p>
      </>
    ),
  },
  {
    id: "hashtags",
    icon: Hash,
    title: "Хэштеги в комментариях",
    body: (
      <>
        <p>
          Если в комментариях к операциям вы пишете теги вида <code>#Mazda3</code>,
          <code>#Катя</code>, <code>#Картино</code> — DzenAnalytics автоматически
          извлекает их и группирует операции по тегам на странице «Хэштеги».
        </p>
        <p className="mt-2 text-muted text-xs">
          Полезно для срезов, не вписывающихся в плоскую категоризацию: проект, поездка,
          член семьи, машина. Тег = словесный токен после <code>#</code>, поддерживаются
          русские буквы и цифры.
        </p>
      </>
    ),
  },
  {
    id: "rules",
    icon: Wand2,
    title: "Правила категоризации",
    body: (
      <>
        <p>
          На странице «Правила» можно задать перезапись категории при импорте: например,
          «если получатель содержит "Магнит", то категория = Еда дома». Полезно для
          операций без категории или с устаревшей категорией.
        </p>
        <p className="mt-2 text-muted text-xs">
          Правила применяются <em>при загрузке транзакций</em>, оригинальная категория
          сохраняется в поле <code>categoryOriginal</code> и восстанавливается при
          отключении правила.
        </p>
        <p className="mt-2 text-muted text-xs">
          Порядок имеет значение: применяется первое подошедшее правило.
        </p>
      </>
    ),
  },
  {
    id: "shortcuts",
    icon: Keyboard,
    title: "Горячие клавиши",
    body: (
      <>
        <p>В DzenAnalytics есть несколько шорткатов:</p>
        <table className="w-full text-sm mt-3">
          <tbody>
            <tr className="border-b border-border">
              <td className="py-2"><kbd className="kbd">Ctrl/⌘ + K</kbd></td>
              <td className="py-2 text-muted">Командная палитра — fuzzy-поиск по всему</td>
            </tr>
            <tr className="border-b border-border">
              <td className="py-2"><kbd className="kbd">Esc</kbd></td>
              <td className="py-2 text-muted">Закрыть drawer / палитру</td>
            </tr>
            <tr className="border-b border-border">
              <td className="py-2"><kbd className="kbd">/</kbd></td>
              <td className="py-2 text-muted">Открыть палитру</td>
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
            <tr>
              <td className="py-2"><kbd className="kbd">g</kbd> <kbd className="kbd">a</kbd></td>
              <td className="py-2 text-muted">Счета</td>
            </tr>
          </tbody>
        </table>
      </>
    ),
  },
  {
    id: "filters",
    icon: Filter,
    title: "Глобальные фильтры и навигация по месяцам",
    body: (
      <>
        <p>
          Панель фильтров наверху аналитических страниц задаёт период, счета,
          категории, валюты, поиск и флаг «без переводов». Стрелки <code>← Месяц →</code>
          — пошаговая навигация: переключаются режим в «Месяц» и листают вперёд/назад
          в пределах данных.
        </p>
        <p className="mt-2 text-muted text-xs">
          Фильтры действуют на: Cash-flow, Категории, Счета, Тренды, Календарь, Топ,
          Хэштеги, Sankey. На Главной, Импорте, Сравнении, Регулярных, Аномалиях,
          Дубликатах, Без категории, Аннотациях, Целях, Бюджетах — нет.
        </p>
      </>
    ),
  },
  {
    id: "saved-views",
    icon: Bookmark,
    title: "Сохранённые виды (Saved Views)",
    body: (
      <p>
        Кнопки «Виды» и «Сохранить» в фильтрах. Сохраняют полную комбинацию
        (период + счета + категории + валюты + поиск + флаг переводов) под именем.
        Применить — один клик. Хранятся в IndexedDB.
      </p>
    ),
  },
  {
    id: "calibration-detail",
    icon: Search,
    title: "Глобальный поиск (`/search`)",
    body: (
      <>
        <p>
          Полнотекст по получателю, комментарию, категории и счёту. Несколько слов через
          пробел — все должны встречаться (AND). Поле «исключить» — наоборот, исключает
          совпадения. Опциональный regex (регистронезависимый).
        </p>
        <p className="mt-2 text-muted text-xs">
          Дополнительно: фильтры по диапазону сумм и дат, тип (расход/доход).
          Результаты можно открыть пакетно в drawer'е через «Открыть всё».
        </p>
      </>
    ),
  },
  {
    id: "backup",
    icon: Database,
    title: "Backup / restore",
    body: (
      <>
        <p>
          На странице Импорт — экспорт всей базы в JSON и импорт обратно. Включает
          транзакции, бюджеты, цели, калибровку, виды, аннотации, флаги категорий,
          инфляцию, правила и настройку группировки получателей.
        </p>
        <p className="mt-2 text-muted text-xs">
          Используйте перед очисткой Application Storage браузера или для переноса
          между устройствами.
        </p>
      </>
    ),
  },
  {
    id: "inflation",
    icon: Percent,
    title: "Поправка на инфляцию",
    body: (
      <>
        <p>
          На странице Импорт — переключатель «Поправка на инфляцию». При включении все
          суммы пересчитываются в реальные деньги <strong>базового года</strong>. Расход
          в 2022 умножается на накопленную инфляцию до базового года. Полезно для
          честного сравнения трат за разные годы.
        </p>
        <p className="mt-2 text-muted text-xs">
          Ставки CPI редактируются. Дефолтные — приближённые к Росстату, можно заменить
          на свои.
        </p>
      </>
    ),
  },
  {
    id: "themes",
    icon: Camera,
    title: "Темы и снимок дашборда",
    body: (
      <>
        <p>
          Переключатель тем в правом верхнем углу: Светлая (по умолчанию) / Тёмная /
          <strong> Авто</strong> (`prefers-color-scheme` системы + по часам:
          20:00–07:00 → тёмная). Выбор сохраняется.
        </p>
        <p className="mt-2">
          Кнопка «Снимок PNG» на Главной экспортирует весь дашборд (со всеми KPI,
          графиками и виджетами) в PNG-файл pixelRatio 2× для retina-дисплеев. Кнопка
          калибровки/баннеры в снимок не попадают.
        </p>
      </>
    ),
  },
  {
    id: "goals",
    icon: Target,
    title: "Цели и бюджеты",
    body: (
      <>
        <p>
          <strong>Цели</strong> (`/goals`) — копить на конкретное (машина, отпуск,
          подушка). Прогресс-бар, расчёт срока на основе текущей нормы сбережений.
        </p>
        <p className="mt-2">
          <strong>Бюджеты</strong> (`/budgets`) — месячные лимиты по категориям с цветным
          прогрессом, маркером прогресса месяца и прогнозом перерасхода при текущем темпе.
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

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <HelpCircle className="w-6 h-6 text-accent" />
          Справка
        </h1>
        <p className="text-muted text-sm mt-1">
          Объяснения концепций DzenAnalytics: что и как считается, зачем нужны
          калибровка / FIRE / σ / правила и так далее. Кликайте по разделам, чтобы
          раскрыть.
        </p>
      </div>

      <div className="card card-pad space-y-1">
        {SECTIONS.map((s) => {
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
}
