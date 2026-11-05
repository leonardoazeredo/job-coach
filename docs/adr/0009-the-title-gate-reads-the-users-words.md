# The title gate reads the user's words, and their exclusion beats their own title

A title qualifies when it names a Search title or a Field term from the user's `profile/search.yaml` and no Excluded word that applies. The gate used to hold front-end words and exclude back-end, mobile and test titles for everyone, so any other field pulled its roles and lost them here. The engine now keeps only words about level and function, which a Search title or Field term of the user's lifts. Field words such as back-end, mobile and full-stack are the user's to exclude, and the user's own Excluded word always wins, even over their own title. We chose that because the alternative leaves the list with no effect: only a title naming a Search title or Field term can pass, so if those beat an exclusion, no exclusion ever removes anything. A contradiction between the user's lists is a warning from the record check, because the file still works and only that title is lost. This leaves ADR 0005 as it is: one gate for every board, and the Field terms are not sent to any board.

## Considered options

- **Titles only, no Field terms**: rejected because a board pulled by location has no other title filter. A user's "React" could not admit "Senior React Engineer" without listing every form of the title.
- **Field terms in the competency pack**: rejected because packs are optional and hold skills phrases, and two people in one field can want different titles.
- **Exclusions only, no list of wanted words**: rejected because a pull by location would then shortlist every job in the city.
- **Keeping the full-stack rule, generalised**: a front-end term or expansion title used to outweigh "full-stack". Generalised, that is the rule above that empties the list, so it went. A user who wants full-stack roles out lists the word, and loses those that also say front-end; one who leaves it off reads a few more titles.
- **Letters anywhere rather than whole words**: rejected because "sales" found "Salesforce" and "test" found "Latest". The cost is that "React" no longer finds "ReactJS", which the user can list.
