# Software Requirements Specification (SRS)
## Cart Application (Spring Boot Backend)

Version: 1.0  
Date: 2026-04-14  
Inputs: BRD - Cart Application.docx, draft ER notes

## 1. Purpose
This SRS defines the functional and non-functional requirements for a backend Shopping Cart Application built as a monolithic Spring Boot system. It refines inconsistent draft definitions and provides a consistent, implementation-ready specification.

## 2. Scope
The system supports:
- User creation and retrieval
- Product catalog management
- Inventory tracking and low-stock detection
- Checkout and order creation
- Notification generation for checkout and low stock

Out of scope:
- Frontend UI
- Payment gateway integration
- JWT or advanced authentication/authorization
- Microservices decomposition
- Cloud deployment concerns

## 3. Stakeholders
- Admin users: maintain product and inventory data, monitor low stock
- Customer users: browse products and place orders
- Development team: build and integrate all modules
- QA team: verify API behavior and end-to-end flow

## 4. Product Overview
- Architecture: Monolithic REST API
- Stack: Java 17+, Spring Boot, Spring Data JPA, Hibernate, MySQL or PostgreSQL, Maven, Lombok
- Package baseline: controller, service, repository, entity, dto, exception, config

## 5. Definitions and Business Terms
- Customer: user who places orders
- Admin: user who manages product and inventory
- Low stock: inventory available quantity is less than or equal to threshold
- Checkout: process that validates user/product/stock, creates order, decrements inventory, and creates notification records

## 6. Functional Requirements

### 6.1 User Module
- FR-USER-001: System shall create a user with first name, last name, email, phone (optional), and role.
- FR-USER-002: System shall return a list of users.
- FR-USER-003: System shall return user details by id.
- FR-USER-004: System shall update user profile fields (excluding immutable id).
- FR-USER-005: System shall enforce unique email across users.

### 6.2 Product Module
- FR-PROD-001: System shall create a product with name, description, category, price, and unique sku.
- FR-PROD-002: System shall return all active products.
- FR-PROD-003: System shall return product details by id.
- FR-PROD-004: System shall update product metadata and price.
- FR-PROD-005: System shall support soft deactivation of products (recommended) or hard delete if required.
- FR-PROD-006: System shall reject duplicate sku values.

### 6.3 Inventory Module
- FR-INV-001: System shall create or initialize inventory for a product.
- FR-INV-002: System shall return inventory by product id.
- FR-INV-003: System shall update available quantity and threshold.
- FR-INV-004: System shall expose low-stock inventory records.
- FR-INV-005: System shall maintain exactly one inventory record per product.
- FR-INV-006: System shall prevent available quantity from becoming negative.

### 6.4 Checkout and Order Module
- FR-ORD-001: System shall accept checkout requests with user id and one or more line items.
- FR-ORD-002: System shall validate user existence and active status.
- FR-ORD-003: System shall validate each product exists and is active.
- FR-ORD-004: System shall validate inventory sufficiency for each line item.
- FR-ORD-005: System shall create an order and order items in one atomic transaction.
- FR-ORD-006: System shall decrement inventory after successful validation.
- FR-ORD-007: System shall calculate and store subtotal and total amount.
- FR-ORD-008: System shall expose order retrieval by order id and by user id.
- FR-ORD-009: System shall set order status lifecycle values from an approved enum.

### 6.5 Notification Module
- FR-NOTIF-001: System shall create checkout confirmation notification(s) on successful order placement.
- FR-NOTIF-002: System shall create low-stock notification(s) when quantity drops to threshold or below.
- FR-NOTIF-003: System shall retrieve notifications by id and by user id.
- FR-NOTIF-004: System shall track notification delivery/read state.

### 6.6 End-to-End Integration Requirements
- FR-INT-001: Supported happy path: create user -> create product -> add inventory -> checkout -> order created -> inventory reduced -> notifications created.
- FR-INT-002: If any checkout validation fails, system shall not persist partial order data.
- FR-INT-003: If inventory update fails, order transaction shall roll back.

## 7. Data Model Requirements (Refined)

### 7.1 Canonical Entities

#### User
- id (PK)
- first_name
- last_name
- email (UNIQUE)
- phone (nullable)
- role (ENUM: ADMIN, CUSTOMER)
- status (ENUM: ACTIVE, INACTIVE)
- created_at
- updated_at

#### Product
- id (PK)
- sku (UNIQUE)
- name
- description (nullable)
- category (nullable)
- price
- is_active
- created_at
- updated_at

#### Inventory
- id (PK)
- product_id (FK -> Product.id, UNIQUE)
- available_quantity
- threshold
- updated_at

#### Orders
- id (PK)
- order_number (UNIQUE)
- user_id (FK -> User.id)
- order_date
- status (ENUM: PENDING, PLACED, CANCELLED, FAILED)
- subtotal_amount
- total_amount
- created_at

#### OrderItem
- id (PK)
- order_id (FK -> Orders.id)
- product_id (FK -> Product.id)
- quantity
- unit_price
- line_total

#### Notification
- id (PK)
- user_id (FK -> User.id)
- type (ENUM: CHECKOUT_CONFIRMATION, LOW_STOCK)
- order_id (FK -> Orders.id, nullable)
- product_id (FK -> Product.id, nullable)
- message
- status (ENUM: PENDING, SENT, READ, FAILED)
- created_at
- sent_at (nullable)
- read_at (nullable)

### 7.2 Required Relationships
- User 1:N Orders
- Orders 1:N OrderItem
- Product 1:N OrderItem
- Product 1:1 Inventory
- User 1:N Notification
- Orders 1:N Notification (optional relationship via order_id)
- Product 1:N Notification (optional relationship via product_id)

### 7.3 Data Integrity Rules
- Email unique in User.
- SKU unique in Product.
- Inventory product_id unique.
- Price, subtotal, total, unit_price, line_total must be >= 0.
- Quantity and available_quantity must be >= 0.
- OrderItem quantity must be > 0.
- For Notification:
  - If type = CHECKOUT_CONFIRMATION, order_id is required.
  - If type = LOW_STOCK, product_id is required.

## 8. API Requirements (Minimum)

### 8.1 User APIs
- POST /api/users
- GET /api/users
- GET /api/users/{id}
- PUT /api/users/{id}

### 8.2 Product APIs
- POST /api/products
- GET /api/products
- GET /api/products/{id}
- PUT /api/products/{id}
- DELETE /api/products/{id}

### 8.3 Inventory APIs
- POST /api/inventory
- GET /api/inventory
- GET /api/inventory/{productId}
- PUT /api/inventory/{productId}
- GET /api/inventory/low-stock

### 8.4 Checkout and Order APIs
- POST /api/checkout
- GET /api/orders
- GET /api/orders/{id}
- GET /api/orders/user/{userId}

### 8.5 Notification APIs
- POST /api/notifications
- GET /api/notifications
- GET /api/notifications/{id}
- GET /api/notifications/user/{userId}

## 9. Validation and Error Requirements
- All create/update APIs shall validate mandatory fields.
- Invalid enum values shall return 400 Bad Request.
- Missing entities referenced by FK shall return 404 Not Found.
- Inventory insufficiency at checkout shall return 409 Conflict.
- Unhandled exceptions shall return 500 with correlation id and safe error message.

## 10. Non-Functional Requirements
- NFR-001 Performance: standard read APIs should respond within 500 ms under normal local load; checkout should respond within 1500 ms.
- NFR-002 Consistency: checkout and inventory update must be transactional.
- NFR-003 Maintainability: layered architecture and DTO-based API contracts.
- NFR-004 Observability: structured logs for checkout, inventory updates, and notification generation.
- NFR-005 Testability: each module must provide verifiable Postman API scenarios.

## 11. Security and Privacy Requirements
- Basic input validation and server-side sanitization are mandatory.
- PII fields (email, phone) should not be logged in plaintext at info level.
- Role checks can be implemented at service level even without JWT.

## 12. Reporting and Audit Requirements
- System should maintain created_at and updated_at timestamps on main entities.
- Checkout failures should be traceable via error logs with request identifiers.

## 13. Acceptance Criteria
- AC-001: End-to-end happy flow runs successfully with expected persisted records.
- AC-002: Insufficient stock prevents order creation and preserves existing stock.
- AC-003: Successful checkout decrements inventory correctly.
- AC-004: Low-stock scenario creates notification records for admin users.
- AC-005: Postman collection demonstrates all module APIs and failure paths.

## 14. Open Clarifications (To Freeze Before Build)
- Whether soft delete is mandatory for Product and User.
- Whether phone number must be unique.
- Exact order status transitions and cancellation policy.
- Whether tax/discount fields are required in MVP or deferred.
- Notification dispatch method in MVP (DB-only vs email/SMS integration).
