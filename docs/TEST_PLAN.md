# Test Plan: NanoClaw WebUI - Slack Interaction & Configuration (QA Expert)

**Version:** 2.0
**Author:** QA Expert
**Date:** 2026-03-15
**Scope:** Functional, UI, and Configuration testing of NanoClaw WebUI, covering Slack-like interactions and core configuration persistence/impact.

## 1. Introduction
This test plan validates the "Slack-like Interaction Refactor" and "Core Configuration" capabilities. It ensures the UI correctly interfaces with the backend (Core) and that configuration changes (Memory, Security) are persisted and affect Agent behavior.

## 2. Test Strategy
- **Environment**: Docker Compose (Local Dev).
- **Tools**: Playwright (E2E), Python `os`/`json` (Backend Verification).
- **Browsers**: Chromium (Headless).
- **Test Data**:
  - Agent: Default "Andy".
  - Channels: "TestChan_[Timestamp]", "EmptyChan".

## 3. Test Cases

### Module: Global Agent Profile & Configuration
| ID | Title | Pre-conditions | Steps | Expected Result | Priority |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **TC-1.1** | View Global Profile | Logged in | Click "Andy" in Sidebar. | Navigate to `/dashboard/agent`. | P1 |
| **TC-1.2** | Edit Global Memory Persistence | TC-1.1 | 1. Edit Memory.<br>2. Save.<br>3. Reload UI. | Content persists in UI. Backend file `groups/CLAUDE.md` updates. | P0 |
| **TC-1.3** | Global Memory Impact | TC-1.2 | 1. Add "You are a pirate" to Memory.<br>2. Chat with Agent. | Agent responds like a pirate ("Arr", etc). | P1 |
| **TC-1.4** | Edit Allowlist Persistence | TC-1.1 | 1. Edit Security JSON.<br>2. Save.<br>3. Reload UI. | Content persists in UI. Backend file `sender-allowlist.json` updates. | P2 |

### Module: Channel Management
| ID | Title | Pre-conditions | Steps | Expected Result | Priority |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **TC-2.1** | Create Channel | Logged in | Create "TestChan". | Redirect to `/dashboard/chat/[jid]`. Sidebar updates. | P0 |
| **TC-2.2** | View Channel Details | TC-2.1 | Click "View Details". | Navigate to `/dashboard/channel/[jid]`. Tabs: Overview, Members, Tasks, Sandbox. | P1 |
| **TC-2.3** | Delete Channel | TC-2.2 | Delete "TestChan". | Redirect to `/dashboard`. Removed from Sidebar. | P1 |

### Module: Member Management
| ID | Title | Pre-conditions | Steps | Expected Result | Priority |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **TC-3.1** | Empty State | New Channel | View Members. | "No agents". | P2 |
| **TC-3.2** | Invite Agent | TC-3.1 | Invite "Andy". | Andy appears. Button "Joined". | P0 |
| **TC-3.3** | Remove Agent | TC-3.2 | Remove "Andy". | Andy removed. | P1 |

### Module: Chat Interaction
| ID | Title | Pre-conditions | Steps | Expected Result | Priority |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **TC-4.1** | Empty Channel Constraint | Empty Channel | Type `@`. | No popup. | P1 |
| **TC-4.2** | Populated Channel Mention | Channel with Agent | Type `@`. | Popup appears. | P0 |
| **TC-4.3** | Real-time Chat | TC-4.2 | Send message. | Message appears. Typing indicator shows. Response received. | P0 |
| **TC-4.4** | Image Upload | Chat View | Upload image. | Image displayed in chat. | P2 |

## 4. Execution
Run `tests/e2e/slack_features_test.py`.
