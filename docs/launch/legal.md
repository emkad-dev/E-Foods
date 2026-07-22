# Launch Legal

Keep the customer legal pages aligned with the publishable markdown in `docs/legal/` and the in-app policy screens.

## Publishable Copy

The current legal copy should stay consistent across:

- `docs/legal/privacy-policy.md`
- `docs/legal/terms-of-service.md`
- `apps/customer/app/(auth)/privacy.tsx`
- `apps/customer/app/(auth)/terms.tsx`
- `apps/customer/app/(auth)/accept-policy.tsx`

### Privacy Policy

- FEASTY is a food delivery service operated by FEASTY.
- Scope is Nigeria only for now.
- Collect account, delivery, order, payment metadata, and device/session data.
- Use the data for account management, fulfillment, fraud prevention, support, and service notices.
- Share data with Paystack, restaurants, delivery partners, and service providers.
- Do not sell personal information.
- Support deletion requests in the app.
- Contact: `feastyfooders@gmail.com`

### Terms of Service

- FEASTY is a food delivery service operated by FEASTY.
- Scope is Nigeria only for now.
- Users are responsible for account activity and secure credentials.
- Orders may require payment verification before processing.
- Payments are handled through Paystack.
- Customers may cancel before restaurant processing.
- Delivered orders are generally final.
- Case-by-case support handling applies when a delivered order cannot be reached or handed over.
- Contact: `feastyfooders@gmail.com`

## Launch Implementation

1. Draft the policy pages.
2. Save them under `docs/legal/`.
3. Add links to the marketing site and app footer.
4. Add the links to the main README.
5. Update the app footer with the same links.

## Recommended Next Step

- Use a template service for launch.
- Schedule a lawyer review after launch.
- Publish the final pages at `feasty.com/terms` and `feasty.com/privacy`.
