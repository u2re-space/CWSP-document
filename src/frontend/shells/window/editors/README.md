# Entity Editors System

Comprehensive entity editing system with modal dialogs, field validation, and filesystem integration.

## Overview

The entity editor system provides a flexible, type-safe way to edit various entity types (tasks, events, persons, services, items, skills) with:

- **Dynamic field generation** based on entity type
- **Specialized field editors** for different data types
- **Validation** with error handling
- **Filesystem integration** using OPFS
- **Modal UI** with keyboard shortcuts
- **Reactive updates** with fest/object

## Architecture

### Level 0 - Core Editor (EntityEdit.ts)

Main orchestration layer that provides:

```typescript
makeEntityEdit(entityItem, entityDesc, options)
makeEvents(entityItem, entityDesc)
makePath(entityItem, entityDesc)
```

### Level 1 - Field Editors (fields/)

Specialized editors for different field types:

- **DateEdit.ts** - Date/time picker with format selection
- **DescriptionEdit.ts** - Multi-part text editor
- **InputListEdit.ts** - Lists for phone, email, URL fields

### Level 2 - Overlays (overlays/)

UI feedback components:

- **Toast.ts** - Success/error notifications
- **Alert.scss** - Alert dialogs
- **Confirm.scss** - Confirmation dialogs
- **Modal.scss** - Modal form styles

## Usage

### Basic Entity Editing

```typescript
import { makeEntityEdit } from "./editors/EntityEdit";

const entity = {
    id: "task-1",
    name: "Sample Task",
    title: "Complete Project",
    type: "task",
    kind: "TASK",
    description: "Project details...",
    // ... other fields
};

const descriptor = {
    type: "task",
    label: "Task",
    DIR: "/user/data/tasks/"
};

// Open editor modal
const updated = await makeEntityEdit(entity, descriptor, {
    description: "Edit task information",
    submitLabel: "Save Changes",
    autoGenerateId: false,
    validateEntity: true,
});

if (updated) {
    console.log("Entity saved:", updated);
}
```

### Event Handlers

```typescript
import { makeEvents } from "./editors/EntityEdit";

const events = makeEvents(entity, descriptor);

// Delete button
deleteBtn.addEventListener("click", events.doDelete);

// Edit button
editBtn.addEventListener("click", events.doEdit);
```

## Field Configuration

Fields are configured per entity type:

```typescript
const FIELD_CONFIGS_BY_TYPE = {
    task: [
        { key: "id", label: "ID", type: "text", required: true },
        { key: "name", label: "Name", type: "text", required: true },
        { key: "title", label: "Title", type: "text", required: true },
        { key: "description", label: "Description", type: "textarea", multiline: true },
        { key: "status", label: "Status", type: "text" },
        { key: "begin_time", label: "Begin Time", type: "date" },
        { key: "end_time", label: "End Time", type: "date" },
        { key: "contacts", label: "Contacts", type: "phone" },
        { key: "tags", label: "Tags", type: "tags" },
    ],
    // ... other types
};
```

## Field Types

### Simple Fields

- **text** - Single-line text input
- **number** - Numeric input
- **textarea** - Multi-line text

### Complex Fields

- **date** - Date/time picker with format selection (ISO, timestamp, etc.)
- **phone** - Phone number list with validation
- **email** - Email address list with validation
- **url** - URL list with preview
- **tags** - Array of text values

## Validation

Validation occurs before save:

```typescript
const validateField = (value, config) => {
    if (config.required && (!value || !value.trim())) {
        return false;
    }
    return true;
};
```

## Filesystem Integration

Entities are saved to OPFS using `writeFile`:

```typescript
const path = makePath(entity, descriptor);
const jsonData = JSON.stringify(entity, null, 2);
await writeFile(null, path, jsonData);
```

Path generation:

```typescript
// Example: /user/data/tasks/complete-project.json
const path = `${descriptor.DIR}${entityId
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9_\-+#&]/g, '-')}.json`;
```

## Modal UI

The editor creates a modal dialog with:

- **Backdrop** - Click to close
- **Escape key** - Close modal
- **Save button** - Validate and save
- **Cancel button** - Close without saving

## Styling

Styles are organized in SCSS layers:

- `fields/_Fields.scss` - General field styles
- `fields/_Button.scss` - Button styles
- `fields/_DateTime.scss` - Date/time picker styles
- `forms/_Modal.scss` - Modal dialog styles
- `overlays/_Toast.scss` - Toast notification styles

## API Reference

### makeEntityEdit(entityItem, entityDesc, options)

Opens an entity editor modal.

**Parameters:**
- `entityItem` - Entity to edit
- `entityDesc` - Entity descriptor (type, label, DIR)
- `options` - Editor options

**Options:**
- `description` - Modal description text
- `submitLabel` - Save button label
- `autoGenerateId` - Auto-generate entity ID
- `validateEntity` - Enable validation
- `allowLinks` - Allow link editing
- `onLinksChange` - Link change callback

**Returns:** Promise<EntityInterface | null>

### makeEvents(entityItem, entityDesc)

Creates event handlers for entity operations.

**Returns:** Object with `doDelete` and `doEdit` handlers

### makePath(entityItem, entityDesc)

Generates filesystem path for entity.

**Returns:** String path

## Field Editor API

All field editors follow this interface:

```typescript
interface FieldEditor {
    block: HTMLElement;
    saveEvent: (...args: any[]) => void;
}
```

### DateEntryEdit({ object, key })

Date/time picker with format selection.

**Formats:**
- ISO Date (iso_date)
- Date String (date)
- Timestamp (timestamp)
- Plain text/number

### DescriptionEdit({ object, key, parts })

Multi-part description editor.

**Features:**
- Multiple text areas
- Add/remove parts
- Array or single value support

### InputListEdit({ object, key, parts }, description)

List editor for phone, email, URL fields.

**Features:**
- Add/remove items
- Format validation
- URL preview
- Specialized input types

## Examples

### Task Editor

```typescript
const task = {
    id: "task-1",
    type: "task",
    kind: "TASK",
    name: "project-task",
    title: "Complete Project",
    description: "Finish the project by deadline",
    status: "in-progress",
    begin_time: { iso_date: "2025-01-01T00:00:00.000Z" },
    end_time: { iso_date: "2025-12-31T23:59:59.999Z" },
    location: "Office",
    contacts: ["+1234567890"],
    tags: ["urgent", "project"],
};

await makeEntityEdit(task, {
    type: "task",
    label: "Task",
    DIR: "/user/data/tasks/",
});
```

### Event Editor

```typescript
const event = {
    id: "event-1",
    type: "event",
    kind: "EVENT",
    name: "meeting",
    title: "Team Meeting",
    description: "Weekly team sync",
    begin_time: { iso_date: "2025-10-08T10:00:00.000Z" },
    end_time: { iso_date: "2025-10-08T11:00:00.000Z" },
    location: "Conference Room A",
    contacts: ["team@example.com"],
    tags: ["meeting", "weekly"],
};

await makeEntityEdit(event, {
    type: "event",
    label: "Event",
    DIR: "/user/data/events/",
});
```

## Error Handling

Errors are handled at multiple levels:

```typescript
try {
    const updated = await makeEntityEdit(entity, descriptor);
} catch (error) {
    console.error("Failed to edit entity:", error);
    // Show error toast
}
```

## Best Practices

1. **Always provide entity descriptor** with type, label, and DIR
2. **Use validation** for required fields
3. **Handle null returns** (user cancelled)
4. **Update UI** after successful save
5. **Use specialized field editors** for complex types
6. **Follow naming conventions** for IDs and paths
7. **Test with different entity types**

## Future Enhancements

- [ ] Undo/redo support
- [ ] Auto-save drafts
- [ ] Field dependencies
- [ ] Custom validators
- [ ] Bulk editing
- [ ] Export/import
- [ ] Version history
- [ ] Collaborative editing
- [ ] Rich text editor
- [ ] Image upload support
