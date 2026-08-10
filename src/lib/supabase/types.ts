/**
 * Типы базы данных.
 *
 * В обычном проекте это генерирует `supabase gen types typescript`. Здесь они
 * написаны руками по supabase/migrations/0001_schema.sql — когда появится
 * доступ к проекту, файл можно заменить сгенерированным без изменений в коде.
 *
 * Insert- и Update-формы выводятся из Row: перечислять три почти одинаковых
 * набора полей для каждой таблицы — верный способ их рассинхронизировать.
 */

/** Поля с DEFAULT или NULL при вставке можно не передавать. */
type Insertable<Row, Required extends keyof Row> = Pick<Row, Required> &
  Partial<Omit<Row, Required>>;

type Updatable<Row> = Partial<Row>;

export type Role = 'owner' | 'admin' | 'member' | 'guest';
export type ItemStatus = 'active' | 'broken' | 'sold' | 'disposed' | 'stored';
export type SpaceKind =
  | 'kitchen' | 'bath' | 'bedroom' | 'living' | 'balcony'
  | 'hallway' | 'storage' | 'garage' | 'other';
export type HomeKind = 'apartment' | 'house' | 'dacha' | 'garage' | 'office' | 'other';
export type DocumentKind = 'manual' | 'receipt' | 'warranty' | 'photo' | 'contract' | 'other';
export type EnergyMode = 'typical' | 'label' | 'power_hours' | 'per_cycle';
export type LabelUnit = 'kwh_year' | 'kwh_100cycles' | 'kwh_1000h';

export interface Profile {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  locale: string | null;
  created_at: string;
  updated_at: string;
}

export interface Household {
  id: string;
  name: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface HouseholdMember {
  household_id: string;
  user_id: string;
  role: Role;
  joined_at: string;
}

export interface HouseholdInvite {
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
}

export interface Home {
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
}

export interface Space {
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
}

export interface ItemCategory {
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
}

export interface Item {
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
}

export interface ItemDocument {
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
}

export interface Task {
  id: string;
  household_id: string;
  item_id: string | null;
  space_id: string | null;
  title: string | null;
  description: string | null;
  due_at: string | null;
  interval_days: number | null;
  assignee_id: string | null;
  status: 'open' | 'done' | 'skipped';
  source: 'manual' | 'warranty' | 'maintenance' | 'consumable';
  completed_at: string | null;
  completed_by: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: Profile;
        Insert: Insertable<Profile, 'id'>;
        Update: Updatable<Profile>;
      };
      households: {
        Row: Household;
        Insert: Insertable<Household, never>;
        Update: Updatable<Household>;
      };
      household_members: {
        Row: HouseholdMember;
        Insert: Insertable<HouseholdMember, 'household_id' | 'user_id'>;
        Update: Updatable<HouseholdMember>;
      };
      household_invites: {
        Row: HouseholdInvite;
        Insert: Insertable<HouseholdInvite, 'household_id' | 'code'>;
        Update: Updatable<HouseholdInvite>;
      };
      homes: {
        Row: Home;
        Insert: Insertable<Home, 'household_id'>;
        Update: Updatable<Home>;
      };
      spaces: {
        Row: Space;
        Insert: Insertable<Space, 'household_id'>;
        Update: Updatable<Space>;
      };
      item_categories: {
        Row: ItemCategory;
        Insert: Insertable<ItemCategory, 'id' | 'name_ru'>;
        Update: Updatable<ItemCategory>;
      };
      items: {
        Row: Item;
        Insert: Insertable<Item, 'household_id' | 'name'>;
        Update: Updatable<Item>;
      };
      documents: {
        Row: ItemDocument;
        Insert: Insertable<ItemDocument, 'household_id'>;
        Update: Updatable<ItemDocument>;
      };
      tasks: {
        Row: Task;
        Insert: Insertable<Task, 'household_id'>;
        Update: Updatable<Task>;
      };
    };
    Views: Record<string, never>;
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
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
