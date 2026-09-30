import { BarChart3, History, Settings, Wallet } from "@lucide/svelte";
import type { Component } from "svelte";
import type {
  DetailView,
  MobileSettingsView,
  PrimaryView,
  View,
} from "./types";

export interface NavigationItem {
  view: PrimaryView;
  label: string;
  pageTitle?: string;
  shortLabel: string;
  description: string;
  icon: Component;
}

export interface WorkspaceTab {
  view: View;
  label: string;
}

export const navItems: NavigationItem[] = [
  {
    view: "overview",
    label: "首頁",
    pageTitle: "財務概況",
    shortLabel: "首頁",
    description: "淨資產與近期活動。",
    icon: BarChart3,
  },
  {
    view: "activity",
    label: "帳務",
    shortLabel: "帳務",
    description: "銀行、刷卡、投資與發票的統一時間軸。",
    icon: History,
  },
  {
    view: "assets",
    label: "資產",
    shortLabel: "資產",
    description: "銀行、信用卡、投資與其他資產集中管理。",
    icon: Wallet,
  },
  {
    view: "settings",
    label: "設定",
    shortLabel: "設定",
    description: "資料來源、排程與偏好。",
    icon: Settings,
  },
];

/** Secondary navigation stays inside the active workspace. */
export const workspaceTabs: Partial<Record<PrimaryView, WorkspaceTab[]>> = {
  activity: [
    { view: "activity-analysis", label: "支出分析" },
    { view: "activity", label: "資金流" },
    { view: "purchases", label: "購買品項" },
  ],
  assets: [
    { view: "assets", label: "資產清冊" },
    { view: "investment-returns", label: "投資收益" },
  ],
  settings: [
    { view: "settings", label: "設定總覽" },
    { view: "data-sources", label: "資料來源" },
    { view: "sync-notifications", label: "同步與通知" },
    { view: "exchange-rates", label: "匯率" },
    { view: "classification-rules", label: "分類規則" },
  ],
};

export const mobilePrimaryViews: PrimaryView[] = [
  "overview",
  "activity",
  "assets",
];

export const detailLabels: Record<
  DetailView,
  { label: string; description: string }
> = {
  investments: { label: "投資", description: "投資持倉與交易紀錄。" },
  "manual-assets": {
    label: "其他資產",
    description: "保險、不動產、交通工具與估值紀錄。",
  },
  purchases: {
    label: "購買品項",
    description: "本月與歷史發票品項、折扣與點數折抵。",
  },
  "activity-analysis": {
    label: "支出分析",
    description: "自動整理固定支出與每月額外支出。",
  },
  "investment-returns": {
    label: "投資收益",
    description: "持倉報酬、買賣與贖回交易及配息紀錄。",
  },
};

export const mobileSettingsLabels: Record<
  MobileSettingsView,
  { label: string; description: string }
> = {
  "data-sources": {
    label: "資料來源與連接器",
    description: "連線與同步。",
  },
  "sync-notifications": {
    label: "同步與通知",
    description: "管理預設同步排程、推播與同步狀態通知。",
  },
  "exchange-rates": {
    label: "匯率",
    description: "查看資產換算使用的參考匯率。",
  },
  "classification-rules": {
    label: "分類規則",
    description: "讓銀行交易依條件自動分類。",
  },
};
