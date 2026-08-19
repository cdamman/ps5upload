# glib 0.18.5 — GHSA-wrw7-89jp-8q8g (dismissed, with reasons)

Dependabot flags `glib 0.18.5` (moderate): unsoundness in the `Iterator`
and `DoubleEndedIterator` impls for `glib::VariantStrIter`. Fixed upstream
in glib 0.20.

The alert is dismissed as **not used**. This file is the working, so the
decision can be re-checked rather than taken on trust.

## Is the vulnerable code reachable?

No. `VariantStrIter` is referenced only inside glib itself:

```text
glib-0.18.5/src/lib.rs
glib-0.18.5/src/variant.rs
glib-0.18.5/src/variant_iter.rs
```

Nothing in `gio 0.18.4`, `gtk 0.18.2`, `gdk 0.18.2`, `webkit2gtk 2.0.2` or
`soup3 0.5.0` mentions it, and ps5upload makes no direct `glib::` calls at
all — `client/src-tauri/src/` contains none.

Checked a second way, because a caller can build that iterator without
naming the type: its only constructor is `Variant::array_iter_str()`
(`glib-0.18.5/src/variant.rs:843`), and no crate in the tree calls it.

To re-check both:

```sh
# by type name
grep -rn 'VariantStrIter' ~/.cargo/registry/src/*/{gio,gtk,gdk,webkit2gtk,soup3}-*/
# by constructor — catches callers that never name the type
grep -rn 'array_iter_str' ~/.cargo/registry/src/*/{gio,gtk,gdk,webkit2gtk,soup3,pango,cairo-rs,atk}-*/
# and our own code
grep -rn 'glib::' client/src-tauri/src/
```

Worth being careful here rather than waving it through: the advisory is
not merely theoretical unsoundness. Recent compilers discard the unsound
write entirely, so affected calls dereference a NULL pointer and crash.
It is genuinely harmless to us only because nothing reaches it.

## Can we just upgrade?

Not without Tauri. The chain that pins it:

```text
glib 0.18.5
  <- gtk / gio / gdk / webkit2gtk  (the gtk-rs 0.18 stack)
    <- wry 0.55.1
      <- tauri-runtime-wry 2.11.4   requires wry "0.55.0"
        <- tauri 2.11.5             (latest release)
```

`wry 0.56.1` exists but is a semver-incompatible bump that
`tauri-runtime-wry` will not accept, so `cargo update` cannot reach it.
glib 0.20 arrives when Tauri moves to gtk-rs 0.20.

## Who is affected?

Linux desktop builds only. macOS and Windows do not compile the GTK
stack, and neither does the engine, the Android build, or the PS5 payload.

## When to revisit

When Tauri ships a release built on gtk-rs 0.20 — at which point a plain
dependency bump should clear this, and the alert should be re-opened if it
does not.
