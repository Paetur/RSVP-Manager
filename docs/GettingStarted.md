# Getting started

Open the administrator link for your installation and sign in with your own account. If you have received an administrator invitation, verify your email and accept it first.

Sign-in supports password-manager AutoFill. If you have forgotten your password, choose **Forgot password?** and follow the latest reset email. The new password must have at least 12 characters; resetting it keeps your administrator permissions. See [administrator sign-in and recovery](Administrators.md#sign-in-and-recover-a-password).

For a first installation, use the [trusted setup companion](AutomaticSetup.md) to create the first Supabase Auth account and grant Full administrator access. Setup closes at the installation checkpoints and its link is hidden afterward. Opening the setup address again does not create another first administrator or reset the installation.

## Find your way around

The three icons at the top open **Home**, **Languages** and **Settings**. On desktop, the release version appears under your name after sign-in.

Home opens **Main**, which contains Overview and Invites. The other tabs are **Events**, **Venues**, **Households**, **Food** and **Other**. Scroll across the Overview columns and select a count to filter Invites. Active filters and **Clear filters** sit below the cards. Use **Group by**, **View**, **Select** and **Search** in the toolbar above the household list. When Apple Shortcuts is enabled, its box appears between Overview and Invites. [Manage invitation drafts](HouseholdsAndInvites.md#make-and-send-bulk-invites)

Your access determines which sections you see. The first Settings tab, **Application**, holds publication controls. Full administrators also see its launch checklist, with pending checks first and completed checks collapsed. The Publication card shows current access and delivery state. Acknowledge the release checks and confirm explicitly before publishing.

- Record editors have their own pencils where you have permission.
- Use a record’s pencil to open its editor. Save keeps your changes; Cancel discards the draft.
- An unchanged existing record normally has a disabled Save button. A new, prefilled reminder is already a draft you can save.

Use the **Search** icon in Households, Invites, Food or Logs to open that list's search field. Closing it clears the search.

Record editors keep independent drafts. Save closes the record editor after a successful update, and Cancel discards its draft. Failed saves keep the editor open for retry. Personal Interface preferences are available with View only access.

The top actions refresh the data, change appearance, open the sign-in-protected guest preview in another tab and sign out. **Settings → Interface** opens **Interface**, **Invites appearance**, **Overview appearance** and **Event messages** directly to their controls. The first tab also contains HTTP/SSL and Apple Shortcuts. Choose **Save** to apply personal preferences to your administrator account or **Cancel** to discard the draft. Saved preferences load when you sign in on another device. The top-bar appearance toggle applies immediately.

- **Appearance** contains the theme, interface language and button hover settings.
- **Date and time** offers the language default, a short month name, a numeric date with dots, or year-month-day. **System default** follows the device’s clock convention. Choose **12-hour (AM/PM)** or **24-hour** to use the same clock format when viewing and editing times across devices. Pick a sample date to preview the format as you edit.
- **Invites appearance** opens directly in its editor. Choose **Phone**, **Tablet**, or **Desktop** to set rows and shown fields. The live **Preview** reflects your choices before you save. Use **Group by** and **View** in Invites to adjust the current list.

In **Overview appearance**, use the checkboxes to show or hide cards. Drag a card by its grip to reorder it, tap the grip for move actions, or focus the grip and press Up or Down. Select **Save** to apply the draft. **Reset to defaults** restores the starting order and visibility after saving.

![Settings → Interface with Appearance, Invites appearance, Overview appearance and Event messages](images/ipad-interface-settings.png)

When another administrator changes event data, **Event data has changed** appears after open edits are resolved. Choose **Refresh** to load the latest data. If a household, venue or session changes while you are editing it, a stale save is rejected and your draft stays in the editor.

## Prepare the event

1. Review event details under Home → Events.
2. Add venues, then sessions with the right venue and local time.
3. Add households and guests, preserving any parent–child grouping you need.
4. Assign session invitations in Households → Household details, or through a session’s household manager.
5. Add food categories and items, quantities, units and venue availability.
6. Review guest-facing text and translations.
7. Test a complete guest journey and keep a protected backup.
8. Under Settings → Application, publish only after you have reviewed and approved the event.

![Event settings, event planning and feature cards on iPad](images/ipad-event-settings.png)

Adding a household does not automatically invite it to every session. Making a food item available at a venue does not send an invitation.

On a wide screen, Events cards can sit side by side. Opening an editor gives it the full row. Under **Home → Venues**, switch between **Venues** and **Sessions** to work on places and activity schedules. Switching these tabs or resizing the window keeps open drafts.

## Set groups and event wording

In **Home → Events → Event planning**, review the current preset, shared labels and groups. Use the pencil in the card’s top-right corner to choose a Wedding, Reunion, Conference, or Custom preset. **Use preset suggestions** adds suggested groups and fills blank labels. Review and save the changes. You can also add, rename, translate, and reorder groups directly.

Shared labels appear in the main navigation, section headings, and the Invites statistics. Group names appear in Households, Invites, and session assignment lists. Move households out of a group before removing it. Planning-template backups carry the saved settings into a fresh installation.

## If you cannot see a section

Ask a Full administrator to review your access. Some actions, such as sending invitations, exporting backups or restoring an event, have separate permissions.

## Feature and guest appearance settings

**Home → Events → Features** enables Food and Other without deleting their existing data. Guest food step chooses interest-only or detailed selection; changing it does not publish or send anything. Edit the food explanation and the reply after Yes under Languages globe → Guests.

**Settings → Interface** holds your personal preferences. Under **Settings → Invitations → Landing page → Invitation appearance**, choose **Phone** for screens below 512 px or **Wide** for screens 512 px and wider. Each profile summarizes its photo, colours, titles, names and appearance. Use the pencil to edit the selected profile. Replace/remove a private JPEG, crop and position it, adjust darkening and box opacity, and choose colors separately for Light/Dark. Open the single Preview to inspect the selected mode, including its unsaved changes. Save applies that mode, Cancel discards its draft, and Reset appearance restores the default treatment while keeping the photo. Photo dimensions, stored size and crop are available under Details. Choose whether guests see a light/dark toggle and their default Light, Dark or System appearance. Hiding the toggle enforces that default. System follows the device. Guest choices are separate from administrator choices.

Venue summaries include mini maps; edit the venue’s saved map URL in its editor. Guest sessions place the welcome beneath the session name, followed by address/time and map. Use authenticated Guest preview to check presentation while unpublished.

[All user guides](README.md)

## Temporary status messages

With **Settings** edit access, open **Settings → Interface → Event messages**. Choose **Phone** for screens below 512 CSS pixels or **Wide** for screens 512 CSS pixels and wider. Set the message filter, **Hide messages after 5 seconds**, and **Show timestamps** for **Admin** and **Guest**. Choose **Save** or **Cancel** for the selected profile. Switching profiles keeps the other profile’s draft available. Timestamps follow the device’s current language and time format. Admin timestamps start enabled and Guest timestamps start disabled.

![Event messages on Phone with separate Admin and Guest controls](images/ipad-event-messages.png)
