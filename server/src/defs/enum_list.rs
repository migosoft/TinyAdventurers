//! `listed_enum!`: declares a fieldless enum together with its `ALL` list and
//! `COUNT`, from one variant list. A new variant is in `ALL` and counted the
//! moment it is written, so per-variant arrays (`[_; COUNT]`) can never be too
//! short. A compile-time check keeps the ids contiguous (`ALL[i] as usize == i`),
//! which is what indexing those arrays by `variant as usize` relies on.

macro_rules! listed_enum {
    ($(#[$meta:meta])* $vis:vis enum $name:ident : $repr:ty { $($(#[$vmeta:meta])* $variant:ident = $id:literal),+ $(,)? }) => {
        $(#[$meta])*
        #[repr($repr)]
        $vis enum $name {
            $($(#[$vmeta])* $variant = $id),+
        }

        impl $name {
            pub const ALL: [$name; [$($name::$variant),+].len()] = [$($name::$variant),+];
            pub const COUNT: usize = $name::ALL.len();
        }

        const _: () = {
            let mut i = 0;
            while i < $name::COUNT {
                assert!($name::ALL[i] as usize == i, "ids must be 0, 1, 2, … in declaration order");
                i += 1;
            }
        };
    };
}

pub(crate) use listed_enum;
