// Utils
export { cn } from './utils/cn';

// UI Components - Core
export { Button, buttonVariants } from './components/ui/button';
export { Badge, badgeVariants } from './components/ui/badge';
export {
  Card,
  CardHeader,
  CardFooter,
  CardTitle,
  CardAction,
  CardDescription,
  CardContent,
} from './components/ui/card';
export { Input } from './components/ui/input';
export { Label } from './components/ui/label';
export { Separator } from './components/ui/separator';
export { Skeleton } from './components/ui/skeleton';
export { Switch } from './components/ui/switch';
export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
} from './components/ui/table';
export { Tabs, TabsList, TabsTrigger, TabsContent } from './components/ui/tabs';
export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
} from './components/ui/dialog';
export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from './components/ui/select';

// UI Components - New from designer
export { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from './components/ui/accordion';
export {
  AlertDialog as AlertDialogUI,
  AlertDialogPortal,
  AlertDialogOverlay,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
} from './components/ui/alert-dialog';
export { Alert, AlertTitle, AlertDescription } from './components/ui/alert';
export { AspectRatio } from './components/ui/aspect-ratio';
export { Avatar, AvatarImage, AvatarFallback } from './components/ui/avatar';
export {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbPage,
  BreadcrumbSeparator,
  BreadcrumbEllipsis,
} from './components/ui/breadcrumb';
export {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselPrevious,
  CarouselNext,
  type CarouselApi,
} from './components/ui/carousel';
export { Checkbox } from './components/ui/checkbox';
export { Collapsible, CollapsibleTrigger, CollapsibleContent } from './components/ui/collapsible';
export {
  Command,
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandShortcut,
  CommandSeparator,
} from './components/ui/command';
export {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuCheckboxItem,
  ContextMenuRadioItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuGroup,
  ContextMenuPortal,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuRadioGroup,
} from './components/ui/context-menu';
export {
  Drawer,
  DrawerPortal,
  DrawerOverlay,
  DrawerTrigger,
  DrawerClose,
  DrawerContent,
  DrawerHeader,
  DrawerFooter,
  DrawerTitle,
  DrawerDescription,
} from './components/ui/drawer';
export {
  DropdownMenu,
  DropdownMenuPortal,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from './components/ui/dropdown-menu';
export {
  useFormField,
  Form,
  FormItem,
  FormLabel,
  FormControl,
  FormDescription,
  FormMessage,
  FormField,
} from './components/ui/form';
export { HoverCard, HoverCardTrigger, HoverCardContent } from './components/ui/hover-card';
export { InputOTP, InputOTPGroup, InputOTPSlot, InputOTPSeparator } from './components/ui/input-otp';
export {
  Menubar,
  MenubarMenu,
  MenubarTrigger,
  MenubarContent,
  MenubarItem,
  MenubarSeparator,
  MenubarLabel,
  MenubarCheckboxItem,
  MenubarRadioGroup,
  MenubarRadioItem,
  MenubarPortal,
  MenubarSubContent,
  MenubarSubTrigger,
  MenubarGroup,
  MenubarSub,
  MenubarShortcut,
} from './components/ui/menubar';
export {
  NavigationMenu,
  NavigationMenuList,
  NavigationMenuItem,
  NavigationMenuContent,
  NavigationMenuTrigger,
  NavigationMenuLink,
  NavigationMenuIndicator,
  NavigationMenuViewport,
  navigationMenuTriggerStyle,
} from './components/ui/navigation-menu';
export {
  Pagination,
  PaginationContent,
  PaginationLink,
  PaginationItem,
  PaginationPrevious,
  PaginationNext,
  PaginationEllipsis,
} from './components/ui/pagination';
export { Popover, PopoverTrigger, PopoverContent, PopoverAnchor } from './components/ui/popover';
export { Progress } from './components/ui/progress';
export { RadioGroup, RadioGroupItem } from './components/ui/radio-group';
export { ResizablePanelGroup, ResizablePanel, ResizableHandle } from './components/ui/resizable';
export { ScrollArea, ScrollBar } from './components/ui/scroll-area';
export {
  Sheet,
  SheetPortal,
  SheetOverlay,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
} from './components/ui/sheet';
export {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInput,
  SidebarInset,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarProvider,
  SidebarRail,
  SidebarSeparator,
  SidebarTrigger,
  useSidebar,
} from './components/ui/sidebar';
export { Slider } from './components/ui/slider';
export { Toaster } from './components/ui/sonner';
export { Textarea } from './components/ui/textarea';
export { ToggleGroup, ToggleGroupItem } from './components/ui/toggle-group';
export { Toggle, toggleVariants } from './components/ui/toggle';
export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from './components/ui/tooltip';
export { useIsMobile } from './components/ui/use-mobile';

// Section Components (from designer)
export { HeroSection } from './components/sections/hero-section';
export { TrustedBySection } from './components/sections/trusted-by-section';
export { Navbar } from './components/sections/navbar';
export { Footer as FooterSection } from './components/sections/footer';
export { InstantDeploymentSection } from './components/sections/instant-deployment-section';
export { WhatIsHyperCLISection } from './components/sections/what-is-hypercli-section';
export { WhyFastSection } from './components/sections/why-fast-section';
export { TemplatesSection } from './components/sections/templates-section';
export { PlaygroundCTASection } from './components/sections/playground-cta-section';
export { PricingSection } from './components/sections/pricing-section';
export { EnterpriseTeaserSection } from './components/sections/enterprise-teaser-section';

// App Components
export { default as Header } from './components/Header';
export { default as Footer } from './components/Footer';
export { default as ContactModal } from './components/ContactModal';
export { default as PartnerFormModal } from './components/PartnerFormModal';
export { default as Modal } from './components/Modal';
export { default as AlertDialog } from './components/AlertDialog';
export { default as Auth } from './components/Auth';
export { Providers } from './components/Providers';
export { AuthConnect } from './components/AuthConnect';
export { AuthProvider, useAuth } from './providers/AuthProvider';
export { WalletProvider, useWallet } from './contexts/WalletContext';
export { RainbowKitProvider } from './providers/RainbowKitProvider';
export { WalletAuth } from './components/WalletAuth';
export { TopUpModal } from './components/TopUpModal';

// Utils
export { cookieUtils } from './utils/cookies';
export { getAuthBackendUrl, getBotApiUrl, getBotWsBase, getLlmApiUrl, withCorsProxy } from './utils/api';
export { debugLog } from './utils/debug';
export { toStripeCents, toUsdcUnits, fromStripeCents, fromUsdcUnits } from './utils/currency';
export { formatDateTime, formatDateTimeShort, formatDate, formatRelativeTime, getUserTimezone, getTimezoneAbbr } from './utils/datetime';
export { getBadgeClass, getTypeBadgeClass } from './utils/badges';
export { GPU_INFO, REGION_INFO, getGPUDisplayName, getGPUVram, getGPUArch, getRegionName, getRegionFlag } from './utils/gpu';
export { NAV_URLS } from './utils/navigation';
