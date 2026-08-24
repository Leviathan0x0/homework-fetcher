import React from 'react';
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react';
import {
  Activity01Icon,
  Alert02Icon,
  AlertCircleIcon,
  ArrowDown01Icon,
  ArrowLeft01Icon,
  ArrowRight01Icon,
  ArrowUp01Icon,
  ArrowUpRight01Icon,
  Attachment01Icon,
  BellIcon,
  BellRingIcon,
  Calendar01Icon,
  CalendarCheck01Icon,
  CalendarDaysIcon,
  Cancel01Icon,
  CancelSquareIcon,
  CctvCameraIcon,
  CheckmarkCircle01Icon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronUpIcon,
  ChevronsLeftIcon,
  ChevronsRightIcon,
  ClipboardListIcon,
  CloudIcon,
  CloudUploadIcon,
  ComputerIcon,
  CreditCardIcon,
  Delete01Icon,
  Delete02Icon,
  Download01Icon,
  DragDropVerticalIcon,
  EyeIcon,
  EyeOffIcon,
  File01Icon,
  FileTextIcon,
  FilterIcon,
  Flag01Icon,
  Folder01Icon,
  FolderOpenIcon,
  GithubIcon,
  Globe02Icon,
  GraduationCapIcon,
  HandshakeIcon,
  HeartHandshakeIcon,
  Image01Icon,
  InboxIcon,
  InformationCircleIcon,
  Key01Icon,
  KeyRoundIcon,
  Layers01Icon,
  LayoutThreeColumnIcon,
  Linkedin01Icon,
  LinkForwardIcon,
  Loading01Icon,
  LockIcon,
  Logout01Icon,
  Mail01Icon,
  Megaphone01Icon,
  MessageCircleIcon,
  MessageSquareIcon,
  MoreHorizontalIcon,
  MoreVerticalIcon,
  NoteIcon,
  PackageIcon,
  PartyPopperIcon,
  PencilEdit01Icon,
  PlusSignCircleIcon,
  PlusSignIcon,
  RefreshCwIcon,
  RefreshIcon,
  ScrollIcon,
  Search01Icon,
  SearchXIcon,
  Settings01Icon,
  Share01Icon,
  ShieldCheckIcon,
  SidebarLeft01Icon,
  SmartPhone01Icon,
  SparklesIcon,
  Sun01Icon,
  Tick02Icon,
  Time01Icon,
  TrendingUpIcon,
  Upload01Icon,
  UserCheck01Icon,
  UserCircleIcon,
  UserCogIcon,
  UserIcon,
  UserMultipleIcon,
  UserRoundIcon,
  UserXIcon,
  VolumeMute01Icon,
  WifiOff01Icon,
  ZoomInIcon,
  ZoomOutIcon,
} from '@hugeicons/core-free-icons';
import { cn } from '../../../utils/cn';
import type { ReiconName, ReiconPreset, ReiconProps } from './types';

export const PaperPlaneFilledIcon: IconSvgElement = [
  [
    'path',
    {
      d: 'M21.707 2.293a1 1 0 0 0-1.069-.225l-18 7a1 1 0 0 0-.145 1.787l6.837 3.907 3.907 6.837a1 1 0 0 0 1.787-.145l7-18a1 1 0 0 0-.317-1.161zM11.618 13.79l-4.527-2.587 11.233-4.368-6.706 6.955z',
      fill: 'currentColor',
      key: '0',
    },
  ],
];

export const CrescentMoonIcon: IconSvgElement = [
  [
    'path',
    {
      d: 'M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z',
      stroke: 'currentColor',
      strokeWidth: '1.5',
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      fill: 'none',
      key: '0',
    },
  ],
];

export const HUGEICONS_MAP: Record<ReiconName, IconSvgElement> = {
  calendar: Calendar01Icon,
  'calendar-check': CalendarCheck01Icon,
  'calendar-days': CalendarDaysIcon,
  check: Tick02Icon,
  'circle-check': CheckmarkCircle01Icon,
  'circle-alert': AlertCircleIcon,
  'circle-plus': PlusSignCircleIcon,
  'circle-user-round': UserCircleIcon,
  x: Cancel01Icon,
  'alert-circle': AlertCircleIcon,
  'alert-triangle': Alert02Icon,
  'triangle-alert': Alert02Icon,
  'octagon-x': CancelSquareIcon,
  info: InformationCircleIcon,
  search: Search01Icon,
  'search-x': SearchXIcon,
  paperclip: Attachment01Icon,
  file: File01Icon,
  'file-text': FileTextIcon,
  image: Image01Icon,
  download: Download01Icon,
  eye: EyeIcon,
  'eye-off': EyeOffIcon,
  bell: BellIcon,
  'bell-ring': BellRingIcon,
  settings: Settings01Icon,
  refresh: RefreshIcon,
  'refresh-cw': RefreshCwIcon,
  upload: Upload01Icon,
  'upload-cloud': CloudUploadIcon,
  cloud: CloudIcon,
  logout: Logout01Icon,
  lock: LockIcon,
  key: Key01Icon,
  'key-round': KeyRoundIcon,
  'shield-check': ShieldCheckIcon,
  'graduation-cap': GraduationCapIcon,
  'message-square': MessageSquareIcon,
  'message-circle': MessageCircleIcon,
  megaphone: Megaphone01Icon,
  'heart-handshake': HeartHandshakeIcon || HandshakeIcon,
  sparkles: SparklesIcon,
  'party-popper': PartyPopperIcon,
  'wifi-off': WifiOff01Icon,
  'chevron-left': ChevronLeftIcon,
  'chevron-right': ChevronRightIcon,
  'chevron-up': ChevronUpIcon,
  'chevron-down': ChevronDownIcon,
  'chevrons-left': ChevronsLeftIcon,
  'chevrons-right': ChevronsRightIcon,
  'user-x': UserXIcon,
  'arrow-left': ArrowLeft01Icon,
  'arrow-right': ArrowRight01Icon,
  'arrow-up': ArrowUp01Icon,
  'arrow-down': ArrowDown01Icon,
  'arrow-up-right': ArrowUpRight01Icon,
  plus: PlusSignIcon,
  pencil: PencilEdit01Icon,
  trash: Delete01Icon,
  'trash-2': Delete02Icon,
  user: UserIcon,
  users: UserMultipleIcon,
  'user-round': UserRoundIcon,
  'user-check': UserCheck01Icon,
  'user-cog': UserCogIcon,
  loader: Loading01Icon,
  clock: Time01Icon,
  folder: Folder01Icon,
  'folder-open': FolderOpenIcon,
  inbox: InboxIcon,
  'external-link': LinkForwardIcon,
  filter: FilterIcon,
  'zoom-in': ZoomInIcon,
  'zoom-out': ZoomOutIcon,
  sun: Sun01Icon,
  moon: CrescentMoonIcon,
  flag: Flag01Icon,
  layers: Layers01Icon,
  'clipboard-list': ClipboardListIcon,
  'scroll-text': ScrollIcon,
  'credit-card': CreditCardIcon,
  'volume-x': VolumeMute01Icon,
  activity: Activity01Icon,
  'notebook-pen': NoteIcon,
  github: GithubIcon,
  globe: Globe02Icon,
  linkedin: Linkedin01Icon,
  smartphone: SmartPhone01Icon,
  monitor: ComputerIcon,
  cctv: CctvCameraIcon,
  'more-horizontal': MoreHorizontalIcon,
  'more-vertical': MoreVerticalIcon,
  'ellipsis-vertical': MoreVerticalIcon,
  'grip-vertical': DragDropVerticalIcon,
  'columns-3': LayoutThreeColumnIcon,
  'panel-left': SidebarLeft01Icon,
  'sidebar-left': SidebarLeft01Icon,
  'trending-up': TrendingUpIcon,
  mail: Mail01Icon,
  send: PaperPlaneFilledIcon,
  share: Share01Icon,
  box: PackageIcon,
};

export const REICON_COMPONENT_MAP = HUGEICONS_MAP;

const PRESET_CLASSES: Record<ReiconPreset, string> = {
  bounce: 'transition-transform duration-200 active:scale-95',
  rotate: 'transition-transform duration-300 group-hover:rotate-45 hover:rotate-45',
  gear: 'transition-transform duration-500 group-hover:rotate-90 hover:rotate-90',
  ring: 'transition-transform duration-200 group-hover:rotate-12 hover:rotate-12',
  spin: 'animate-spin',
  pulse: 'animate-pulse',
  scale: 'transition-transform duration-200 active:scale-95 hover:scale-105',
  shake: 'transition-transform duration-150 group-hover:-rotate-6 hover:-rotate-6',
  lift: 'transition-transform duration-200 active:scale-95',
  zoom: 'transition-transform duration-200 active:scale-95 hover:scale-105',
  none: '',
};

export const Reicon = React.forwardRef<SVGSVGElement, ReiconProps>(
  (
    {
      name,
      size = 20,
      className,
      preset = 'none',
      isLoading,
      isActive: _isActive,
      isFilled: _isFilled,
      color = 'currentColor',
      strokeWidth = 1.5,
      weight: _weight,
      'aria-hidden': ariaHidden,
      'aria-label': ariaLabel,
      role,
      ...props
    },
    ref
  ) => {
    const isSpinner = Boolean(isLoading || name === 'loader');
    const numericSize = typeof size === 'number' ? size : Number.parseInt(String(size), 10) || 20;
    const numericStrokeWidth =
      typeof strokeWidth === 'number' ? strokeWidth : Number.parseFloat(String(strokeWidth)) || 1.5;

    const isHidden = ariaHidden !== undefined ? ariaHidden : ariaLabel ? undefined : true;
    const computedRole = role || (ariaLabel ? 'img' : undefined);
    const presetClass = isSpinner ? 'animate-spin' : preset !== 'none' ? PRESET_CLASSES[preset] : '';

    const effectiveIcon = isSpinner ? Loading01Icon : HUGEICONS_MAP[name] || File01Icon;

    return (
      <HugeiconsIcon
        ref={ref}
        icon={effectiveIcon}
        size={numericSize}
        color={color}
        strokeWidth={numericStrokeWidth}
        aria-hidden={isHidden}
        aria-label={ariaLabel}
        role={computedRole}
        className={cn('inline-block shrink-0 align-middle select-none', presetClass, className)}
        {...props}
      />
    );
  }
);

Reicon.displayName = 'Reicon';
