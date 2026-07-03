# MVP Scope

## Objective

Deliver a minimal, reliable ordering platform that covers the full conversion loop for customers, restaurants, dispatch, and admin.

## In Scope

- Customer app
  - Restaurant discovery and menu browsing
  - Cart and checkout
  - Paystack payment flow for card or bank transfer
  - Order tracking with basic delivery statuses
- Partner app
  - Receive new orders and accept or decline them
  - Mark orders as prepared
- Dispatch app
  - Create rider profiles
  - Assign riders to orders and update delivery states
- Admin web console
  - First admin bootstrap
  - Approve partner restaurants and dispatch accounts

## Out of Scope

- Wallet features
- Advanced loyalty or discount engine
- Multi-region scaling beyond the initial launch city

## Success Metrics

- Successful checkout rate of at least 90 percent in the test sandbox
- End-to-end sandbox completion time under 20 minutes per test, including approvals
- Zero critical production bugs in the first 48 hours after launch

## Test Checklist

- Paystack test transactions for card and bank transfer
- Webhook replay tests for `paystack-webhook`
- Prisma migration deploy on staging
- Role and claim tests for admin and partner flows

## Ownership

Assign named owners in GitHub issues created from this list.
