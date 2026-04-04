# Field Mapping System

Documentation for entity schema to field editor mapping.

## Overview

The field mapping system connects entity interfaces to appropriate field editors, ensuring type-safe and consistent editing experiences.

## Entity Type Mappings

### Task Interface

```typescript
interface TaskInterface extends PropBase {
    status: string;
    begin_time: TimeType;
    end_time: TimeType;
    location: string;
    contacts: string;
    members: string[];
    events: string[];
}
```

**Field Mappings:**

| Field | Editor | Type | Notes |
|---|---|---|---|
| `id` | Text Input | text | Required, unique |
| `name` | Text Input | text | Required, identifier |
| `title` | Text Input | text | Required, display name |
| `description` | DescriptionEdit | textarea | Multi-part text |
| `status` | Text Input | text | Task status |
| `begin_time` | DateEntryEdit | date | Start time |
| `end_time` | DateEntryEdit | date | End time |
| `location` | Text Input | text | Physical location |
| `contacts` | InputListEdit | phone | Contact numbers |
| `members` | InputListEdit | list | Member IDs |
| `events` | InputListEdit | list | Event IDs |
| `tags` | InputListEdit | tags | Tags array |

### Event Interface

```typescript
interface EventInterface extends PropBase {
    begin_time: TimeType;
    end_time: TimeType;
    location: string;
    contacts: string;
}
```

**Field Mappings:**

| Field | Editor | Type | Notes |
|---|---|---|---|
| `id` | Text Input | text | Required, unique |
| `name` | Text Input | text | Required, identifier |
| `title` | Text Input | text | Required, display name |
| `description` | DescriptionEdit | textarea | Multi-part text |
| `begin_time` | DateEntryEdit | date | Event start |
| `end_time` | DateEntryEdit | date | Event end |
| `location` | Text Input | text | Event venue |
| `contacts` | InputListEdit | phone | Contact info |
| `tags` | InputListEdit | tags | Tags array |

### Person Interface

```typescript
interface PersonInterface extends PropBase {
    home: string;
    jobs: string[];
    biography: string;
    contacts: string;
    services: string[];
}
```

**Field Mappings:**

| Field | Editor | Type | Notes |
|---|---|---|---|
| `id` | Text Input | text | Required, unique |
| `name` | Text Input | text | Required, identifier |
| `title` | Text Input | text | Required, display name |
| `description` | DescriptionEdit | textarea | Multi-part text |
| `home` | Text Input | text | Home address |
| `biography` | DescriptionEdit | textarea | Life story |
| `contacts` | InputListEdit | phone | Contact methods |
| `jobs` | InputListEdit | list | Job IDs |
| `services` | InputListEdit | list | Service IDs |
| `tags` | InputListEdit | tags | Tags array |

### Service Interface

```typescript
interface ServiceInterface extends PropBase {
    location: string;
    persons: string[];
    specialization: string[];
    contacts: string;
}
```

**Field Mappings:**

| Field | Editor | Type | Notes |
|---|---|---|---|
| `id` | Text Input | text | Required, unique |
| `name` | Text Input | text | Required, identifier |
| `title` | Text Input | text | Required, display name |
| `description` | DescriptionEdit | textarea | Service details |
| `location` | Text Input | text | Service location |
| `contacts` | InputListEdit | phone | Contact info |
| `persons` | InputListEdit | list | Person IDs |
| `specialization` | InputListEdit | tags | Specializations |
| `tags` | InputListEdit | tags | Tags array |

### Item Interface

```typescript
interface ItemInterface extends PropBase {
    price: number;
    quantity: number;
    availability: string[];
    attributes: Record<string, any>;
}
```

**Field Mappings:**

| Field | Editor | Type | Notes |
|---|---|---|---|
| `id` | Text Input | text | Required, unique |
| `name` | Text Input | text | Required, identifier |
| `title` | Text Input | text | Required, display name |
| `description` | DescriptionEdit | textarea | Item details |
| `price` | Number Input | number | Item price |
| `quantity` | Number Input | number | Stock quantity |
| `availability` | InputListEdit | list | Availability |
| `tags` | InputListEdit | tags | Tags array |

### Skill Interface

```typescript
interface SkillInterface extends PropBase {
    level: string;
    category: string[];
    related: string[];
}
```

**Field Mappings:**

| Field | Editor | Type | Notes |
|---|---|---|---|
| `id` | Text Input | text | Required, unique |
| `name` | Text Input | text | Required, identifier |
| `title` | Text Input | text | Required, display name |
| `description` | DescriptionEdit | textarea | Skill description |
| `level` | Text Input | text | Proficiency level |
| `category` | InputListEdit | tags | Categories |
| `related` | InputListEdit | list | Related skills |
| `tags` | InputListEdit | tags | Tags array |

## Common Fields

All entities inherit from `EntityInterface`:

```typescript
interface EntityInterface<T, K> {
    id: string;
    type: T;
    kind: K;
    name: string;
    title: string;
    variant: string;
    description: string | string[];
    image: string;
    icon: string;
    tags: string[];
    properties: T;
}
```

## Time Type Mapping

```typescript
interface TimeType {
    date?: string;
    iso_date?: string;
    timestamp?: number;
}
```

**Formats:**
- `iso_date` - ISO 8601 date string
- `date` - Localized date string
- `timestamp` - Unix timestamp (ms)

**Editor:** DateEntryEdit allows format selection

## Array Field Handling

Array fields use `InputListEdit` with configurable item types:

- **Tags** - Simple text items
- **IDs** - Reference to other entities
- **URLs** - Web links with validation
- **Emails** - Email addresses with validation
- **Phones** - Phone numbers with formatting

## Custom Field Types

To add custom field types:

1. Create field editor in `fields/`
2. Add type to `FieldConfig` interface
3. Map type in `createFieldElement()`
4. Update `FIELD_CONFIGS_BY_TYPE`

Example:

```typescript
// 1. Create ColorEdit.ts
export const ColorEdit = ({ object, key }) => {
    // ... implementation
    return { block, saveEvent };
};

// 2. Add to FieldConfig
type FieldType = "text" | "color" | ...;

// 3. Map in createFieldElement
if (config.type === "color") {
    return ColorEdit({ object: entityItem, key });
}

// 4. Update configs
const FIELD_CONFIGS_BY_TYPE = {
    task: [
        { key: "color", label: "Color", type: "color" },
        // ...
    ]
};
```

## Validation Rules

Validation is configured per field:

```typescript
interface FieldConfig {
    required?: boolean;
    pattern?: RegExp;
    min?: number;
    max?: number;
    minLength?: number;
    maxLength?: number;
}
```

Example:

```typescript
{
    key: "email",
    label: "Email",
    type: "email",
    required: true,
    pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
}
```

## Field Dependencies

For fields that depend on other fields:

```typescript
{
    key: "end_time",
    label: "End Time",
    type: "date",
    dependsOn: "begin_time",
    validate: (value, entity) => {
        return value > entity.begin_time;
    }
}
```

## Conditional Fields

Show/hide fields based on conditions:

```typescript
{
    key: "price",
    label: "Price",
    type: "number",
    condition: (entity) => entity.type === "item",
}
```

## Field Grouping

Organize fields into sections:

```typescript
const FIELD_GROUPS = {
    task: [
        {
            title: "Basic Information",
            fields: ["id", "name", "title", "description"]
        },
        {
            title: "Schedule",
            fields: ["begin_time", "end_time", "location"]
        },
        {
            title: "Contacts & Members",
            fields: ["contacts", "members"]
        }
    ]
};
```

## Best Practices

1. **Use appropriate editors** for field types
2. **Validate data** before saving
3. **Handle array fields** properly
4. **Provide clear labels** and help text
5. **Group related fields** logically
6. **Use consistent naming** conventions
7. **Test all field types** thoroughly

## Future Enhancements

- [ ] Dynamic field generation from schema
- [ ] Field-level permissions
- [ ] Computed fields
- [ ] Field templates
- [ ] Import/export field configs
- [ ] Visual field editor
- [ ] Field versioning
- [ ] Custom validators library

