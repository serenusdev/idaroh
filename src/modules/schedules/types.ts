export type EventCategory =
  | "teknologi"
  | "keagamaan"
  | "operasional"
  | "umum";

export type AudienceConfig = {
  scope: "all" | "member_type" | "team" | "users";
  memberTypes?: string[];
  teamIds?: string[];
  userIds?: string[];
};

export type EventStatusBadge =
  | "on_schedule"
  | "upcoming"
  | "location_changed"
  | "cancelled";

export interface ScheduleEventItem {
  id: string;
  startsAt?: string;
  endsAt?: string;
  dateStr?: string;
  timeRangeStr: string;
  statusBadge: EventStatusBadge;
  statusLabel: string;
  category: EventCategory;
  categoryLabel: string;
  title: string;
  location: string;
  previousLocation?: string;
  speakerOrHost?: string;
  groupName?: string;
  attendeesCount?: number;
  actionType: "detail" | "target" | "map";
  actionLabel: string;
  subNote?: string;
  audienceConfig?: AudienceConfig;
  recurrenceRule?: string;
  recurrenceUntil?: string;
  /** For a recurring agenda the events row this list row was expanded from. */
  baseEventId?: string;
  /** WIB calendar date of this occurrence, the key of an exception row. */
  occurrenceDate?: string;
  cancelledOccurrence?: boolean;
}

export interface AnnouncementItem {
  id: string;
  title: string;
  bodyMarkdown: string;
  priority: "normal" | "important";
  isPinned: boolean;
  expiresAtStr?: string;
  targetAudienceLabel: string;
  publishedAtStr: string;
  isRead: boolean;
  audienceConfig?: AudienceConfig;
  status?: "draft" | "published" | "archived";
  scheduledFor?: string;
}

export interface WeekDayPickerItem {
  dayName: string;
  dateNum: number;
  fullDate: string;
  isActive: boolean;
  hasEvent: boolean;
}

