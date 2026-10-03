# Recharge UI refinement

## Design direction

Preserve Recharge's wordmark and forest green identity. Use restrained sage surfaces, layered white cards, realistic miniature objects, clear labels and a consistent action location. Cards should feel tactile without distracting from daily work.

Every one of the 37 catalog modules has a distinct illustration. Approved Maintenance uses a repair wrench and payment approval stamp. Onboarding Invoices uses an invoice tray and property key. No module shares another module's atlas cell. A regression check renders the entire catalog and checks this uniqueness.

## Assets

Mode: generated with the built-in image generation tool. Final transparent assets are `public/recharge-tools-1.png` and `public/recharge-tools-2.png`, each a five-column, four-row atlas. The component uses optical alignment and isolated crops. Decorative artwork has empty alternative text. If an image fails, the original module icon remains available as a fallback.

Prompt direction: realistic premium isometric 3D still-life objects, dark emerald, sage, ivory and muted brass, consistent upper-left studio light, transparent background, unique object group in each cell, no text or brand logos. Each subject is tied to its tool's actual purpose. The three unused spare cells are not assigned to tools.

## Interaction changes

The entire tool card is one keyboard-accessible target. Working centers retain their routes. Planned and disconnected tools open a clearly labeled details dialog. Furnishing, recurring bin and garden, and AirCover board handlers are connected when those modules are granted.

Dialogs sit above the preview bar, scroll within the viewport, have 44-pixel close controls, trap keyboard focus and close with Escape. Team modals use the shared dialog primitive and return focus to their invoking button. Cleaning form labels are associated with their controls. Save failures appear inside the dialog; network failures release the saving state. Workflow update failures leave tickets unchanged and display an alert.

Mobile navigation has a backdrop, Escape support, keyboard focus containment, focus restoration and body scroll locking. Closed navigation is hidden from keyboard traversal. The preview sidebar follows the measured banner height. Mobile department headers are compact enough to show the first complete card at 390 by 844 pixels.

Motion uses short CSS transitions for view entry, card elevation and illustration movement. Reduced-motion preferences suppress animations and transforms.

## Verification

Production preview build and TypeScript checks passed. Targeted ESLint has no errors; existing unused overview/tool components and native image advisories remain. Twelve component, file-response and preview isolation checks passed, including distinct illustrations across all modules.

Browser checks covered desktop 1440 by 960 and mobile 390 by 844, no horizontal overflow, tool navigation, search empty state and clear action, planned-tool dialog opening and focus restoration, cleaning form dropdown selection and rejected save feedback, team modal focus trapping and Escape, long phone form scrolling, and reduced-motion CSS. The shared visual lint helper was not available, so layout geometry and rendered screenshots were inspected directly.

The public site remains a read-only preview with synthetic data. These UI improvements do not connect live accounts, enable writes or establish production readiness.
