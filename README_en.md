# Judgeman Bot

A Discord court simulation bot based on the cursed technique **"Deadly Sentencing" (诛伏赐死/誅伏賜死)** of Hiromi Higuruma from the anime/manga series "Jujutsu Kaisen".

> [!WARNING]
> **This is a joke bot.**
> It is intended for resolving minor internal server disputes, fun role-playing, or as a prank. Do not use it for serious legal matters or significant decision-making.

---

## Basic Commands
To initiate a trial, use one of the following slash commands. All trigger the same function:
- `/judgement` (Recommended)
- `/誅伏賜死`
- `/開廷`
- `/deadly-sentencing`

### Parameters (Arguments)
- **prosecutor**: The participant who pursues the defendant's guilt.
- **defendant**: The participant accused of a crime.
- **judge**: The authority who listens to the parties and delivers a verdict.
- **charge**: A description of the incident/crime (Text).
- **defencer**: The participant who supports the defendant.
- ※ If left blank, the defendant will act as their own **Defendant & Defencer**.

---

## Workflow: Trial Progression

### 1. Summoning & Verification
When the command is executed, the "Judgeman" appears in the court (channel). The following conditions are automatically checked:
- **Online Check**: All participants must be actually "Online" (Idle or DND status not allowed).
- **Activity Check**: All participants must have spoken in the server within the last hour.
- **Role Overlap**: Participants cannot hold multiple roles (except Defendant+Defencer).
- **Cooldown**: The executor must wait 7 days between summons (can be disabled in settings).

### 2. Validity Hearing (Pre-Trial Vote)
A 1-minute vote is cast regarding the validity of the charge.
- **Defendant's Weight**: The defendant's "Invalid" vote counts as **3 votes**.
- **Instant Dismissal**: If any participant other than the defendant (Judge, Prosecutor, Defencer) votes "Invalid", the trial is immediately dismissed.
- **Approval**: The trial only proceeds if "Valid" votes exceed "Invalid" votes.

### 3. Public Trial (Phase 1)
Upon commencement, participants undergo the following changes:
- **Role Assignment**: Specific roles are granted: **Judge** (Gold), **Prosecutor** (Red), **Defencer** (Blue), **Defendant** (Gray).
- **Nickname Sync**: Nicknames change temporarily to `【Role】Name` (e.g., `【Judge】Username`).
  - ※ Original names are saved and automatically restored when the court adjourns.
- **Mute Warning**: Participants are forbidden from chatting in any other channel in the server; messages in other channels will be automatically deleted.

5 minutes after the trial starts (10s in test mode), the Judge is given the power to deliver a verdict.

### 4. Verdict & Appeal (Retrial)
- **Guilty Verdict (`/gu`)**: Delivered by the Judge. Penalty depends on the server mode.
- **Innocent Verdict (`/in`)**: Delivered by the Judge. The trial ends with an acquittal.
- **Appeal (`/re`)**: Can be used within 30 seconds of a `/gu` verdict by the Defendant or Defencer. Up to Phase 3 (Final Trial) is possible, with penalty multipliers increasing (2x → 4x).
- **Jury Voting**: From Phase 2 onwards, the decision is made by "Jury" (non-participants) votes instead of the Judge.

---

## Punishment Modes (Server Settings)
Use `/settingjudge` to toggle the punishment mode for your server. The `/gu` command options will automatically adjust to match the setting.

- **Timeout Mode**: Physically enforces a server timeout (1 to 5 mins).
- **Batsu (Punishment Game) Mode**: No timeout is applied; instead, the Judge specifies a text-based "Punishment Game".
- **None Mode**: Only a symbolic "Guilty" verdict is announced with no physical penalty.

※ When the mode is switched, the bot automatically re-registers its slash commands to display the relevant input fields.

---

## Special Features
- **/dm [Recipient] [Content]**: Secure private communication between participants.
- **/action [Content]**: Declare an in-court action (e.g., "Objection!", "Present evidence") to be recorded in logs.
- **/info**: Displays current trial status and penalty multipliers.
- **/forceclose**: 【Dev Only】Forcefully ends the trial and restores all roles/names.

---

## Setup Guide

### 1. Discord Developer Portal
1. Create an application and enable all **Privileged Gateway Intents** in the "Bot" section.
   - `Presence Intent`, `Server Members Intent`, `Message Content Intent`
2. Invite the bot with the following permissions:
   - `Manage Roles`, `Manage Nicknames`, `Moderate Members`, `Send Messages`, `View Channels`
3. **CRITICAL**: Move the **"Judgeman" role above the roles of any potential participants** in your server settings. Otherwise, nickname changes and timeouts will fail.

### 2. Environment Variables (.env)
```env
DISCORD_TOKEN=YourBotToken
GUILD_ID=TargetServerID
CLIENT_ID=BotClientID

# Channel IDs where trials are allowed, separated by commas.
# If blank, trials can be initiated in any channel.
ALLOWED_CHANNELS=123456789,987654321

# Role ID required ONLY to initiate a trial (Domain Expansion).
# Actions during the trial (verdicts, appeals, etc.) are permitted based on assigned roles.
REQUIRED_ROLE_ID=

# 7-day cooldown override for development.
DISABLE_COOLDOWN=true
```
