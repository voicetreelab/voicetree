Need help figuring out how to continue development with voicetree UI.

need: UI for visualizing and editting  markdown tree, that I have full control over. and support
launching coding agents.

currently I have obsidian, with three plugins, juggl for graph viz, hover editor for editing nodes on
ui, terminal for ai agents on canvas.

tech debt is getting high with juggl development, I can start adding tests, cleaning up the repo etc,
but I need to figure out if that is worth it now in this current ecosytem, or i should migrate now
while still lower lock in.

the problems with this ecosystem are: many dependencies, (obsidian plus plugins). this makes
distribution very hard (users need obsidian pre installed), and since obsidian isn't open source, the
plugin ecosystem isn't perfect to dev on.

so thinking i may need to bite the bullet and make my own UI.

However, I need to do this in a way that minimizes dev effort.

perhaps
- an existing markdown editting UI open source that i could use as base
- perhaps copying over the source code for the plugins I am currently using, then figuring out a way to make them compatible in the new markdown ui.


thoughts? think hard


///

the other aspect is that for distribution and user acquisition it would be pretty nice to be able to have a version that ppl can quickly access as a website. However this would make the agent aspect really really hard bc agents live in the terminal. But we can remove agent feature from website whilst still sharing most of the common code.

maybe it will even be possible later to have web agents (by having some sort of vm for each web user, but thats complex)