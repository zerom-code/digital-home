/**
 * Типы базы данных.
 *
 * В обычном проекте это генерирует `supabase gen types typescript`. Здесь они
 * написаны руками по миграциям — когда появится доступ к проекту, файл можно
 * заменить сгенерированным без изменений в остальном коде.
 *
 * Две вещи, без которых supabase-js молча схлопывает все запросы в `never`:
 *
 *   1. Формы строк объявлены через `type`, а не `interface`. Ограничение
 *      GenericTable требует `Record<string, unknown>`, а интерфейс без
 *      индексной сигнатуры под него не подходит — тип-алиас подходит.
 *   2. У каждой таблицы есть `Relationships`. Поле кажется лишним, но без
 *      него таблица не совпадает с GenericTable, и вывод типов ломается
 *      целиком, а не для одной таблицы.
 *
 * Insert- и Update-формы выводятся из Row: перечислять три почти одинаковых
 * набора полей для каждой таблицы — верный способ их рассинхронизировать.
 */

/** Поля с DEFAULT или NULL при вставке можно не передавать. */
type Insertable<Row, Required extends keyof Row> = Pick<Row, Required> &
  Partial<Omit<Row, Required>>;

type Updatable<Row> = Partial<Row>;

/** Внешние ключи в рукописных типах не описываем: вложенные select не нужны. */
type NoRelations = [];

export type Role = 'owner' | 'admin' | 'member' | 'guest';
export type ItemStatus = 'active' | 'broken' | 'sold' | 'disposed' | 'stored';
export type SpaceKind =
  | 'kitchen' | 'bath' | 'bedroom' | 'living' | 'balcony'
  | 'hallway' | 'storage' | 'garage' | 'other';
export type HomeKind = 'apartment' | 'house' | 'dacha' | 'garage' | 'office' | 'other';
export type DocumentKind = 'manual' | 'receipt' | 'warranty' | 'photo' | 'contract' | 'other';
export type EnergyMode = 'typical' | 'label' | 'power_hours' | 'per_cycle';
export type LabelUnit = 'kwh_year' | 'kwh_100cycles' | 'kwh_1000h';
export type TariffKind = 'single' | 'two_zone';
export type MeterKind = 'electricity' | 'water_cold' | 'water_hot' | 'gas' | 'heat';
export type EnergySource = 'user' | 'category_default' | 'ai_nameplate';
export type Confidence = 'low' | 'medium' | 'high';
export type TaskStatus = 'open' | 'done' | 'skipped';
export type TaskSource = 'manual' | 'warranty' | 'maintenance' | 'consumable';

export type Profile = {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  locale: string | null;
  created_at: string;
  updated_at: string;
};

export type Household = {
  id: string;
  name: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

export type HouseholdMember = {
  household_id: string;
  user_id: string;
  role: Role;
  joined_at: string;
};

export type HouseholdInvite = {
  id: string;
  household_id: string;
  code: string;
  role: Exclude<Role, 'owner'>;
  expires_at: string | null;
  max_uses: number | null;
  used_count: number;
  created_by: string | null;
  revoked_at: string | null;
  created_at: string;
};

export type Home = {
  id: string;
  household_id: string;
  name: string | null;
  kind: HomeKind | null;
  address: string | null;
  area_m2: number | null;
  floor: number | null;
  notes: string | null;
  sort_order: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

export type Space = {
  id: string;
  household_id: string;
  home_id: string | null;
  parent_id: string | null;
  name: string | null;
  kind: SpaceKind | null;
  icon: string | null;
  color: string | null;
  photo_path: string | null;
  area_m2: number | null;
  notes: string | null;
  sort_order: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

export type ItemCategory = {
  id: string;
  parent_id: string | null;
  name_ru: string;
  icon: string | null;
  sort_order: number;
  default_energy_mode: EnergyMode | null;
  default_power_w: number | null;
  default_standby_w: number | null;
  default_duty_cycle: number | null;
  default_hours_per_day: number | null;
  default_kwh_per_cycle: number | null;
  default_cycles_per_week: number | null;
  label_unit: LabelUnit | null;
  default_warranty_months: number | null;
  default_service_interval_days: number | null;
};

export type Item = {
  id: string;
  household_id: string;
  home_id: string | null;
  space_id: string | null;
  category_id: string | null;
  /** Единственное обязательное поле во всей карточке (ADR-006) */
  name: string;
  brand: string | null;
  model: string | null;
  serial_number: string | null;
  purchased_at: string | null;
  price: number | null;
  currency: string | null;
  seller: string | null;
  warranty_months: number | null;
  warranty_until: string | null;
  condition: string | null;
  status: ItemStatus;
  photo_path: string | null;
  notes: string | null;
  qr_slug: string | null;
  guest_visible: boolean;
  sort_order: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

export type ItemDocument = {
  id: string;
  household_id: string;
  item_id: string | null;
  home_id: string | null;
  space_id: string | null;
  kind: DocumentKind | null;
  title: string | null;
  storage_path: string | null;
  external_url: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  page_count: number | null;
  uploaded_by: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

export type Task = {
  id: string;
  household_id: string;
  item_id: string | null;
  space_id: string | null;
  title: string | null;
  description: string | null;
  due_at: string | null;
  interval_days: number | null;
  assignee_id: string | null;
  status: TaskStatus;
  source: TaskSource;
  completed_at: string | null;
  completed_by: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

export type Consumable = {
  id: string;
  household_id: string;
  item_id: string | null;
  name: string | null;
  part_number: string | null;
  interval_days: number | null;
  last_replaced_at: string | null;
  next_due_at: string | null;
  qty_in_stock: number | null;
  shop_url: string | null;
  price: number | null;
  currency: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

/**
 * Энергопрофиль вещи — по одному на вещь (в базе стоит unique на item_id).
 *
 * Заполненными бывают только поля выбранного режима: у холодильника это
 * power_w и duty_cycle, у стиралки — kwh_per_cycle. Остальные так и остаются
 * пустыми, и это норма, а не недозаполненность (docs/03-energy.md).
 */
export type EnergyProfile = {
  id: string;
  household_id: string;
  item_id: string;
  mode: EnergyMode;
  power_w: number | null;
  standby_w: number | null;
  duty_cycle: number | null;
  hours_per_day: number | null;
  days_per_week: number | null;
  kwh_per_cycle: number | null;
  cycles_per_week: number | null;
  label_value: number | null;
  label_unit: LabelUnit | null;
  night_share: number | null;
  seasonality: Record<string, number> | null;
  source: EnergySource | null;
  confidence: Confidence | null;
  created_at: string;
  updated_at: string;
};

/**
 * Тариф с историей: effective_from / effective_to.
 *
 * Старые записи не удаляются и не переписываются — иначе пересчёт прошлых
 * месяцев врал бы по сегодняшней цене.
 */
export type Tariff = {
  id: string;
  household_id: string;
  name: string | null;
  kind: TariffKind;
  rate_day: number | null;
  rate_night: number | null;
  night_start: string | null;
  night_end: string | null;
  standing_charge: number | null;
  currency: string | null;
  effective_from: string;
  effective_to: string | null;
  created_at: string;
  updated_at: string;
};

export type Meter = {
  id: string;
  household_id: string;
  home_id: string | null;
  kind: MeterKind | null;
  serial: string | null;
  zones: number;
  unit: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

export type MeterReading = {
  id: string;
  household_id: string;
  meter_id: string;
  read_at: string;
  value_day: number | null;
  value_night: number | null;
  photo_path: string | null;
  created_by: string | null;
  created_at: string;
};

export type ServiceRecord = {
  id: string;
  household_id: string;
  item_id: string;
  kind: 'repair' | 'maintenance' | 'install' | 'inspection' | null;
  performed_at: string | null;
  contact_id: string | null;
  cost: number | null;
  currency: string | null;
  description: string | null;
  next_due_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

export type PushSubscriptionRow = {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth_key: string;
  user_agent: string | null;
  created_at: string;
  last_used_at: string | null;
  failed_at: string | null;
};

export type NotificationRow = {
  id: string;
  household_id: string;
  user_id: string | null;
  task_id: string | null;
  title: string;
  body: string | null;
  url: string | null;
  status: 'queued' | 'sent' | 'failed' | 'skipped';
  attempts: number;
  error: string | null;
  send_after: string;
  sent_at: string | null;
  created_at: string;
};

export type AiSettings = {
  household_id: string;
  enabled: boolean;
  monthly_limit_usd: number;
  consent_at: string | null;
  consent_by: string | null;
};

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: Profile;
        Insert: Insertable<Profile, 'id'>;
        Update: Updatable<Profile>;
        Relationships: NoRelations;
      };
      households: {
        Row: Household;
        Insert: Partial<Household>;
        Update: Updatable<Household>;
        Relationships: NoRelations;
      };
      household_members: {
        Row: HouseholdMember;
        Insert: Insertable<HouseholdMember, 'household_id' | 'user_id'>;
        Update: Updatable<HouseholdMember>;
        Relationships: NoRelations;
      };
      household_invites: {
        Row: HouseholdInvite;
        Insert: Insertable<HouseholdInvite, 'household_id' | 'code'>;
        Update: Updatable<HouseholdInvite>;
        Relationships: NoRelations;
      };
      homes: {
        Row: Home;
        Insert: Insertable<Home, 'household_id'>;
        Update: Updatable<Home>;
        Relationships: NoRelations;
      };
      spaces: {
        Row: Space;
        Insert: Insertable<Space, 'household_id'>;
        Update: Updatable<Space>;
        Relationships: NoRelations;
      };
      item_categories: {
        Row: ItemCategory;
        Insert: Insertable<ItemCategory, 'id' | 'name_ru'>;
        Update: Updatable<ItemCategory>;
        Relationships: NoRelations;
      };
      items: {
        Row: Item;
        Insert: Insertable<Item, 'household_id' | 'name'>;
        Update: Updatable<Item>;
        Relationships: NoRelations;
      };
      documents: {
        Row: ItemDocument;
        Insert: Insertable<ItemDocument, 'household_id'>;
        Update: Updatable<ItemDocument>;
        Relationships: NoRelations;
      };
      tasks: {
        Row: Task;
        Insert: Insertable<Task, 'household_id'>;
        Update: Updatable<Task>;
        Relationships: NoRelations;
      };
      consumables: {
        Row: Consumable;
        Insert: Insertable<Consumable, 'household_id'>;
        Update: Updatable<Consumable>;
        Relationships: NoRelations;
      };
      service_records: {
        Row: ServiceRecord;
        Insert: Insertable<ServiceRecord, 'household_id' | 'item_id'>;
        Update: Updatable<ServiceRecord>;
        Relationships: NoRelations;
      };
      energy_profiles: {
        Row: EnergyProfile;
        Insert: Insertable<EnergyProfile, 'household_id' | 'item_id'>;
        Update: Updatable<EnergyProfile>;
        Relationships: NoRelations;
      };
      tariffs: {
        Row: Tariff;
        Insert: Insertable<Tariff, 'household_id'>;
        Update: Updatable<Tariff>;
        Relationships: NoRelations;
      };
      meters: {
        Row: Meter;
        Insert: Insertable<Meter, 'household_id'>;
        Update: Updatable<Meter>;
        Relationships: NoRelations;
      };
      meter_readings: {
        Row: MeterReading;
        Insert: Insertable<MeterReading, 'household_id' | 'meter_id'>;
        Update: Updatable<MeterReading>;
        Relationships: NoRelations;
      };
      push_subscriptions: {
        Row: PushSubscriptionRow;
        Insert: Insertable<PushSubscriptionRow, 'user_id' | 'endpoint' | 'p256dh' | 'auth_key'>;
        Update: Updatable<PushSubscriptionRow>;
        Relationships: NoRelations;
      };
      notifications: {
        Row: NotificationRow;
        Insert: Insertable<NotificationRow, 'household_id' | 'title'>;
        Update: Updatable<NotificationRow>;
        Relationships: NoRelations;
      };
      ai_settings: {
        Row: AiSettings;
        Insert: Insertable<AiSettings, 'household_id'>;
        Update: Updatable<AiSettings>;
        Relationships: NoRelations;
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      create_household: {
        Args: { p_name?: string | null };
        Returns: string;
      };
      accept_invite: {
        Args: { p_code: string };
        Returns: string;
      };
      search_items: {
        Args: { p_query: string };
        Returns: Item[];
      };
      refresh_my_tasks: {
        Args: Record<PropertyKey, never>;
        Returns: number;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};
