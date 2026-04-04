# SelectEdit Field Editor

Dedicated select dropdown field editor module for entity forms.

## Overview

`SelectEdit.ts` provides a reusable select dropdown component with proper state management, validation, and accessibility features.

## API

### SelectEdit({ object, key }, config)

Creates a select dropdown field editor.

**Parameters:**

- `object` - The object containing the field value
- `key` - The property key to edit
- `config` - Configuration object

**Config Options:**

```typescript
interface SelectConfig {
    options: SelectOption[];     // Required: Array of options
    label?: string;              // Field label (default: "Select")
    required?: boolean;          // Is field required (default: false)
    placeholder?: string;        // Placeholder option (disabled)
}

interface SelectOption {
    value: string;               // Option value
    label: string;               // Display label
}
```

**Returns:**

```typescript
{
    block: HTMLElement;          // The field DOM element
    saveEvent: () => void;       // Save function
}
```

## Usage

### Basic Usage

```typescript
import { SelectEdit } from "./fields/SelectEdit";

const entity = {
    status: "in-progress"
};

const { block, saveEvent } = SelectEdit(
    { object: entity, key: "status" },
    {
        options: [
            { value: "pending", label: "Pending" },
            { value: "in-progress", label: "In Progress" },
            { value: "completed", label: "Completed" }
        ],
        label: "Task Status",
        required: true
    }
);

document.body.appendChild(block);
```

### With Placeholder

```typescript
const { block } = SelectEdit(
    { object: entity, key: "priority" },
    {
        options: [
            { value: "low", label: "Low" },
            { value: "medium", label: "Medium" },
            { value: "high", label: "High" }
        ],
        label: "Priority",
        placeholder: "Select priority..."
    }
);
```

### In Entity Editor

```typescript
// EntityEdit.ts
const PROPERTIES_FIELD_CONFIGS_BY_TYPE = {
    task: [
        {
            key: "status",
            label: "Status",
            type: "select",
            required: true,
            options: [
                { value: "pending", label: "Pending" },
                { value: "in-progress", label: "In Progress" },
                { value: "completed", label: "Completed" },
                { value: "cancelled", label: "Cancelled" },
                { value: "on-hold", label: "On Hold" },
            ]
        }
    ]
};

// Automatically handled by createFieldElement()
if (config.type === "select" && config.options) {
    return SelectEdit({ object: entityItem, key }, {
        options: config.options,
        label: config.label,
        required: config.required
    });
}
```

## Features

### State Management

- **Initial Value**: Loads existing value from object
- **Reactive Binding**: Uses `stringRef` for reactive updates
- **Auto-Save**: Saves on change event
- **Fallback**: Defaults to first option if no value

### Validation

- **Required Field**: Supports required attribute
- **Empty Check**: Can validate against empty values
- **Options Validation**: Warns if no options provided

### Accessibility

- **Label Association**: Proper `for`/`id` connection
- **ARIA Support**: Native `<select>` semantics
- **Keyboard Navigation**: Arrow keys, typing to select
- **Screen Reader**: Full screen reader support
- **Focus Management**: Clear focus indicators

### Memory Management

- **WeakMap Bindings**: Efficient memory cleanup
- **Reference Tracking**: Tracks field-object relationships
- **WeakRef**: Uses WeakRef for DOM references

## HTML Structure

```html
<div class="modal-field" data-key="status" data-type="select">
    <label class="label" for="status">Status *</label>
    <select
        name="status"
        id="status"
        data-required="true"
    >
        <option value="" disabled>Select status...</option>
        <option value="pending">Pending</option>
        <option value="in-progress" selected>In Progress</option>
        <option value="completed">Completed</option>
    </select>
</div>
```

## Styling

Styles are defined in `_Modal.scss`:

```scss
.modal-field[data-type="select"] select {
    cursor: pointer;
    padding-inline-end: 2rem;
    appearance: none;
    background-image: url("data:image/svg+xml,..."); // Custom arrow
    background-repeat: no-repeat;
    background-position: calc(100% - 0.65rem) center;

    &:hover {
        border-color: ...;
        background-color: ...;
    }

    &:focus {
        background-image: ...; // Darker arrow
    }
}
```

## Event Handling

### Change Event

```typescript
selectRef?.addEventListener("change", (ev) => {
    saveEvent();                    // Save to object
    fieldValue.value = selectRef.value;  // Update reactive ref
});
```

### Manual Save

```typescript
const { saveEvent } = SelectEdit(...);

// Later...
saveEvent(); // Manually save current value
```

## Common Use Cases

### Task Status

```typescript
{
    key: "status",
    label: "Status",
    type: "select",
    options: [
        { value: "pending", label: "Pending" },
        { value: "in-progress", label: "In Progress" },
        { value: "completed", label: "Completed" },
        { value: "cancelled", label: "Cancelled" }
    ]
}
```

### Priority Level

```typescript
{
    key: "priority",
    label: "Priority",
    type: "select",
    options: [
        { value: "low", label: "Low" },
        { value: "medium", label: "Medium" },
        { value: "high", label: "High" },
        { value: "urgent", label: "Urgent" }
    ]
}
```

### Category Selection

```typescript
{
    key: "category",
    label: "Category",
    type: "select",
    options: [
        { value: "work", label: "Work" },
        { value: "personal", label: "Personal" },
        { value: "family", label: "Family" },
        { value: "health", label: "Health" }
    ]
}
```

### Visibility

```typescript
{
    key: "visibility",
    label: "Visibility",
    type: "select",
    options: [
        { value: "public", label: "Public" },
        { value: "private", label: "Private" },
        { value: "team", label: "Team Only" }
    ]
}
```

## Error Handling

### No Options

```typescript
if (!options || options.length === 0) {
    console.warn(`SelectEdit: No options provided for field "${key}"`);
    return { block: null, saveEvent: () => { } };
}
```

### No Key

```typescript
if (!key || !object) {
    return { block: null, saveEvent: () => { } };
}
```

## TypeScript Types

```typescript
interface FieldWithKey {
    key: string;
    field: any;
}

interface ObjectAndKey {
    object?: any | null;
    key?: string | null;
}

interface SelectOption {
    value: string;
    label: string;
}

interface SelectConfig {
    options: SelectOption[];
    label?: string;
    required?: boolean;
    placeholder?: string;
}
```

## Comparison with Other Editors

| Feature | SelectEdit | InputListEdit | DateEdit |
|---|---|---|---|
| Field Type | Single select | Multiple items | Date/time |
| Options | Predefined | Dynamic | Format options |
| Add/Remove | No | Yes | No |
| Initial Value | Single | Array | Date object |
| Use Case | Status, category | Tags, contacts | Dates, times |

## Best Practices

1. **Provide Clear Labels**: Use descriptive labels for better UX
2. **Limit Options**: Keep options list manageable (< 20 items)
3. **Order Logically**: Order by frequency or alphabetically
4. **Default Value**: Ensure sensible default selection
5. **Use Placeholder**: Add placeholder for clarity
6. **Validate**: Mark required fields appropriately

## Future Enhancements

- [ ] Multi-select support
- [ ] Option groups (`<optgroup>`)
- [ ] Search/filter large option lists
- [ ] Custom option rendering
- [ ] Dynamic option loading
- [ ] Disabled options
- [ ] Option descriptions/tooltips
- [ ] Icon support in options

## Related Files

- `EntityEdit.ts` - Uses SelectEdit for select fields
- `_Modal.scss` - Styling for select fields
- `DateEdit.ts` - Similar pattern for date fields
- `InputListEdit.ts` - Similar pattern for list fields

