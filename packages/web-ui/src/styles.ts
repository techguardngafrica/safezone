import { breakpoints, colors, motion, radii, spacing, typography } from '@safezone/design-tokens';

/**
 * Global stylesheet for the Next.js apps, generated from design tokens so there is one source of truth.
 * Render once in the root layout: <style dangerouslySetInnerHTML={{ __html: webUiCss }} />.
 * Inline styles cannot express hover, focus-visible, media queries or reduced motion, so the shared
 * components use these `sz-` classes for those states.
 */
const c = colors;
export const webUiCss = `
*,*::before,*::after{box-sizing:border-box}
html,body{margin:0;padding:0}
body{background:${c.semantic.background};color:${c.semantic.text};font-family:${typography.fontFamily.sans};font-size:${typography.size.md}px;line-height:${typography.lineHeight.normal};-webkit-font-smoothing:antialiased}
a{color:${c.semantic.link}}
:focus-visible{outline:2px solid ${c.semantic.focusRing};outline-offset:2px}
.sz-num{font-variant-numeric:tabular-nums}
.sz-visually-hidden{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}

.sz-btn{display:inline-flex;align-items:center;justify-content:center;gap:${spacing[2]}px;border-radius:${radii.md}px;padding:0 ${spacing[4]}px;min-height:40px;font:inherit;font-size:${typography.size.sm}px;font-weight:${typography.weight.semibold};cursor:pointer;border:1px solid transparent;white-space:nowrap;text-decoration:none;transition:background ${motion.duration.fast}ms}
.sz-btn:disabled{cursor:not-allowed;opacity:.6}
.sz-btn-primary{background:${c.brand.primary};color:${c.brand.onPrimary}}
.sz-btn-primary:hover:not(:disabled){background:${c.brand.primaryHover}}
.sz-btn-secondary{background:${c.brand.secondary};color:${c.brand.onSecondary}}
.sz-btn-secondary:hover:not(:disabled){background:${c.brand.secondaryHover}}
.sz-btn-outline{background:${c.semantic.surface};color:${c.semantic.text};border-color:${c.semantic.borderStrong}}
.sz-btn-outline:hover:not(:disabled){background:${c.semantic.surfaceMuted}}
.sz-btn-danger{background:${c.status.danger};color:#fff}
.sz-btn-danger:hover:not(:disabled){filter:brightness(.9)}
.sz-btn-text{background:transparent;color:${c.brand.primary};padding:0 ${spacing[2]}px}
.sz-btn-text:hover:not(:disabled){background:${c.brand.primarySubtle}}
.sz-btn-sm{min-height:32px;padding:0 ${spacing[3]}px;font-size:${typography.size.xs + 1}px}

.sz-shell{display:grid;grid-template-columns:264px 1fr;min-height:100vh}
.sz-sidebar{background:${c.semantic.surface};border-right:1px solid ${c.semantic.borderSubtle};position:sticky;top:0;height:100vh;overflow-y:auto;padding:${spacing[4]}px ${spacing[3]}px}
.sz-brand{display:flex;align-items:center;gap:${spacing[2]}px;padding:${spacing[2]}px ${spacing[3]}px ${spacing[4]}px;font-weight:${typography.weight.bold};font-size:${typography.size.lg}px;color:${c.brand.primary}}
.sz-nav-group{margin:${spacing[4]}px 0 ${spacing[1]}px;padding:0 ${spacing[3]}px;font-size:${typography.size.xs}px;color:${c.semantic.textMuted};font-weight:${typography.weight.semibold};text-transform:uppercase;letter-spacing:.04em}
.sz-nav-link{display:flex;align-items:center;gap:${spacing[3]}px;min-height:40px;padding:0 ${spacing[3]}px;border-radius:${radii.pill}px;color:${c.semantic.text};text-decoration:none;font-size:${typography.size.sm}px;font-weight:${typography.weight.medium};position:relative}
.sz-nav-link:hover{background:${c.neutral[50]}}
.sz-nav-link[aria-current="page"]{background:${c.brand.primarySubtle};color:${c.brand.primary};font-weight:${typography.weight.semibold}}
.sz-nav-link[aria-current="page"]::before{content:"";position:absolute;left:-${spacing[3]}px;top:8px;bottom:8px;width:3px;border-radius:0 3px 3px 0;background:${c.brand.primary}}
.sz-nav-badge{margin-left:auto;min-width:20px;height:20px;padding:0 6px;border-radius:${radii.pill}px;background:${c.brand.primary};color:#fff;font-size:${typography.size.xs}px;display:inline-flex;align-items:center;justify-content:center}
.sz-nav-badge-danger{background:${c.status.danger}}
.sz-main{min-width:0;display:flex;flex-direction:column}
.sz-topbar{height:64px;display:flex;align-items:center;gap:${spacing[3]}px;padding:0 ${spacing[6]}px;background:${c.semantic.surface};border-bottom:1px solid ${c.semantic.borderSubtle};position:sticky;top:0;z-index:20}
.sz-content{padding:${spacing[6]}px;max-width:1600px;width:100%}
.sz-menu-toggle{display:none}
@media (max-width:${breakpoints.lg - 1}px){
  .sz-shell{grid-template-columns:1fr}
  .sz-sidebar{position:fixed;left:0;top:0;z-index:40;width:264px;transform:translateX(-100%);transition:transform ${motion.duration.base}ms;box-shadow:0 8px 24px rgba(46,51,49,.16)}
  .sz-sidebar[data-open="true"]{transform:none}
  .sz-menu-toggle{display:inline-flex}
  .sz-topbar{padding:0 ${spacing[4]}px}
  .sz-content{padding:${spacing[4]}px}
}

.sz-page-header{display:flex;align-items:flex-start;justify-content:space-between;gap:${spacing[4]}px;flex-wrap:wrap;margin-bottom:${spacing[5]}px}
.sz-page-header h1{margin:0;font-size:${typography.size.xxl}px;line-height:${typography.lineHeight.tight};color:${c.semantic.text}}
.sz-page-header p{margin:${spacing[1]}px 0 0;color:${c.semantic.textMuted};font-size:${typography.size.sm}px;max-width:720px}
.sz-crumbs{font-size:${typography.size.sm}px;color:${c.semantic.textMuted};margin-bottom:${spacing[2]}px;display:flex;gap:${spacing[1]}px;flex-wrap:wrap}
.sz-crumbs button,.sz-crumbs a{background:none;border:0;padding:0;font:inherit;color:${c.semantic.link};cursor:pointer;text-decoration:underline}

.sz-card{background:${c.semantic.surface};border:1px solid ${c.semantic.borderSubtle};border-radius:${radii.lg}px;padding:${spacing[5]}px}
.sz-card h2{margin:0 0 ${spacing[3]}px;font-size:${typography.size.lg}px}
.sz-grid{display:grid;gap:${spacing[4]}px;grid-template-columns:repeat(auto-fill,minmax(220px,1fr))}
.sz-stat-label{font-size:${typography.size.sm}px;color:${c.semantic.textMuted};display:flex;align-items:center;gap:${spacing[2]}px}
.sz-stat-value{font-size:${typography.size.xxl}px;font-weight:${typography.weight.bold};margin-top:${spacing[2]}px}
.sz-stat-link{text-decoration:none;color:inherit;display:block}
.sz-stat-link:hover .sz-card{border-color:${c.semantic.border}}

.sz-toolbar{display:flex;gap:${spacing[3]}px;flex-wrap:wrap;align-items:flex-end;margin-bottom:${spacing[4]}px}
.sz-table-wrap{background:${c.semantic.surface};border:1px solid ${c.semantic.borderSubtle};border-radius:${radii.lg}px;overflow-x:auto}
.sz-table{width:100%;border-collapse:collapse;font-size:${typography.size.sm}px}
.sz-table th{position:sticky;top:0;background:${c.brand.primarySubtle};color:${c.neutral[700]};font-weight:${typography.weight.semibold};text-align:left;padding:${spacing[3]}px ${spacing[4]}px;white-space:nowrap}
.sz-table td{padding:${spacing[3]}px ${spacing[4]}px;border-top:1px solid ${c.semantic.borderSubtle};height:48px;vertical-align:middle}
.sz-table tr[data-clickable="true"]{cursor:pointer}
.sz-table tbody tr:hover{background:${c.neutral[50]}}
.sz-table tr[aria-selected="true"]{background:${c.brand.primarySubtle}}
.sz-table .sz-right{text-align:right}
.sz-table-footer{display:flex;justify-content:center;padding:${spacing[3]}px;border-top:1px solid ${c.semantic.borderSubtle}}
.sz-muted{color:${c.semantic.textMuted}}

.sz-pill{display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 ${spacing[3]}px;border-radius:${radii.pill}px;font-size:${typography.size.xs}px;font-weight:${typography.weight.medium};white-space:nowrap}

.sz-field{display:grid;gap:${spacing[1]}px;min-width:0}
.sz-field label,.sz-field legend{font-size:${typography.size.sm}px;font-weight:${typography.weight.medium}}
.sz-field small{font-size:${typography.size.xs}px;color:${c.semantic.textMuted}}
.sz-error{color:${c.status.danger};font-size:${typography.size.xs + 1}px}
.sz-input{min-height:40px;border:1px solid ${c.semantic.borderStrong};border-radius:${radii.md}px;padding:${spacing[2]}px ${spacing[3]}px;font:inherit;font-size:${typography.size.sm}px;background:${c.semantic.surface};color:${c.semantic.text};width:100%}
.sz-input[aria-invalid="true"]{border:2px solid ${c.status.danger}}
textarea.sz-input{min-height:96px;resize:vertical}
.sz-check{display:flex;align-items:center;gap:${spacing[2]}px;font-size:${typography.size.sm}px;min-height:32px}
.sz-check input{width:18px;height:18px;accent-color:${c.brand.primary}}
.sz-form{display:grid;gap:${spacing[4]}px}
.sz-form-2{display:grid;gap:${spacing[4]}px;grid-template-columns:repeat(auto-fit,minmax(220px,1fr))}

.sz-scrim{position:fixed;inset:0;background:${c.overlay.scrim};z-index:50;display:flex;align-items:center;justify-content:center;padding:${spacing[4]}px}
.sz-dialog{background:${c.semantic.surface};border-radius:${radii.lg}px;padding:${spacing[5]}px;width:100%;max-width:480px;max-height:calc(100vh - 32px);overflow-y:auto;box-shadow:0 16px 40px rgba(46,51,49,.2)}
.sz-dialog h2{margin:0 0 ${spacing[2]}px;font-size:${typography.size.lg}px}
.sz-dialog-actions{display:flex;justify-content:flex-end;gap:${spacing[2]}px;margin-top:${spacing[5]}px;flex-wrap:wrap}
.sz-drawer-scrim{position:fixed;inset:0;background:${c.overlay.scrim};z-index:45}
.sz-drawer{position:fixed;top:0;right:0;bottom:0;width:min(560px,100vw);background:${c.semantic.surface};z-index:46;display:flex;flex-direction:column;box-shadow:-8px 0 24px rgba(46,51,49,.16)}
.sz-drawer-head{display:flex;align-items:center;justify-content:space-between;gap:${spacing[3]}px;padding:${spacing[4]}px ${spacing[5]}px;border-bottom:1px solid ${c.semantic.borderSubtle}}
.sz-drawer-head h2{margin:0;font-size:${typography.size.lg}px}
.sz-drawer-body{padding:${spacing[5]}px;overflow-y:auto;flex:1}
.sz-icon-btn{display:inline-flex;align-items:center;justify-content:center;width:40px;height:40px;border-radius:${radii.pill}px;border:0;background:transparent;color:${c.semantic.text};cursor:pointer}
.sz-icon-btn:hover{background:${c.semantic.surfaceMuted}}

.sz-banner{display:flex;gap:${spacing[3]}px;align-items:flex-start;padding:${spacing[3]}px ${spacing[4]}px;border-radius:${radii.md}px;font-size:${typography.size.sm}px;margin-bottom:${spacing[4]}px}
.sz-state{display:flex;flex-direction:column;align-items:center;text-align:center;padding:${spacing[7]}px ${spacing[4]}px;gap:${spacing[2]}px}
.sz-state-icon{width:64px;height:64px;border-radius:${radii.pill}px;background:${c.brand.primarySubtle};color:${c.brand.primary};display:flex;align-items:center;justify-content:center;margin-bottom:${spacing[2]}px}
.sz-state h3{margin:0;font-size:${typography.size.lg}px}
.sz-state p{margin:0;color:${c.semantic.textMuted};font-size:${typography.size.sm}px;max-width:420px}
.sz-skeleton{background:${c.semantic.surfaceMuted};border-radius:${radii.sm}px;height:14px;animation:sz-pulse 1.2s ease-in-out infinite}
@keyframes sz-pulse{0%,100%{opacity:1}50%{opacity:.55}}
@media (prefers-reduced-motion:reduce){.sz-skeleton{animation:none}.sz-sidebar{transition:none}}

.sz-tabs{display:flex;gap:${spacing[1]}px;border-bottom:1px solid ${c.semantic.borderSubtle};margin-bottom:${spacing[4]}px;overflow-x:auto}
.sz-tab{background:none;border:0;border-bottom:2px solid transparent;padding:${spacing[2]}px ${spacing[3]}px;font:inherit;font-size:${typography.size.sm}px;font-weight:${typography.weight.medium};color:${c.semantic.textMuted};cursor:pointer;white-space:nowrap;min-height:40px}
.sz-tab[aria-selected="true"]{color:${c.brand.primary};border-bottom-color:${c.brand.primary}}
.sz-dl{display:grid;grid-template-columns:minmax(120px,max-content) 1fr;gap:${spacing[2]}px ${spacing[4]}px;margin:0;font-size:${typography.size.sm}px}
.sz-dl dt{color:${c.semantic.textMuted}}
.sz-dl dd{margin:0}
.sz-timeline{list-style:none;margin:0;padding:0;display:grid;gap:${spacing[3]}px}
.sz-timeline li{display:grid;grid-template-columns:12px 1fr;gap:${spacing[3]}px;font-size:${typography.size.sm}px}
.sz-timeline li::before{content:"";width:10px;height:10px;border-radius:50%;background:${c.brand.primary};margin-top:5px}
.sz-drill{background:repeating-linear-gradient(45deg,${c.statusSubtle.warning.background},${c.statusSubtle.warning.background} 10px,#fff 10px,#fff 20px);color:${c.statusSubtle.warning.text};font-weight:${typography.weight.bold};text-align:center;padding:${spacing[1]}px;border-radius:${radii.sm}px;letter-spacing:.1em;font-size:${typography.size.xs}px}
`;
