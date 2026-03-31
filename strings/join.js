Agentic Workflow for Drafting Templates
Accord Project, GSoC 2026
Mentors
Sanket Shevkar
Niall Roche
Mentee
Apoorv Saxena
github: apoorvsxna
discord: proof_._
email: apoorv.sxna@gmail.com
Timezone: IST (UST +5:30)
________________
Introduction
This project would improve the process of drafting Cicero templates for end-users. Currently, users need to have legal domain knowledge as well as programming knowledge in order to make their static contract a smart one using Accord Project’s tools. The goal here is to build an agentic workflow capable of autonomously drafting a valid “smart” legal template based on the requirements provided by the user.
Relevant Research
Legal prose is hard to get right
The project description appears to expect the agent to generate a complete template (legal text, CiceroMark, Concerto, and TypeScript) purely from natural language requirements.
While we can generate the other three components in a guided manner; in my opinion, legal text generation should be out of scope for this project. Relying on LLMs for legal prose introduces challenges, primarily due to jurisdictional variations. A relevant study I came across found that GPT 4 hallucinates almost half the time when asked specific questions involving legal context, and another study that found that the effect of few-shot learning for legal knowledge is unreliable, further backing my intuition.
Also, since AI-generated legal text would require expert review for liability anyway, our main focus should be automating the non-legal tasks. I propose that we should expect a user-provided, static contract as the initial input, and treat it as the basis for “template requirements”.


RAG v/s. Context Stuffing
These are the 2 main techniques used to provide an LLM with additional information post-training. RAG has been the leading choice over the majority of applications that have come out in recent times. The motivation for RAG was that you couldn’t fit all the context in a prompt. However, now with the large context windows that a lot of LLMs have, context stuffing (putting all info in a single prompt) is being seen as a viable option.
While that would simplify our approach greatly, by doing so, we would create a dependency on the user’s choice of LLM. Therefore, I will choose to go with RAG to keep it agnostic.
Note: The knowledge base for the AI assistant that we have in template-playground is basically a single prompt containing some domain-specific instructions for concerto etc. but obviously, it is not the entire documentation. That’s an entirely different approach which I feel wouldn’t be effective for an autonomous agent.
MCP v/s. CLI
Sometimes, it’s considered an unsaid requirement to build an MCP server for every single tool our agent would need to use. I find this process worthwhile only if the tool in question doesn’t have a usable CLI already. For example: an MCP server for docs is a good idea while an MCP server for a python compiler is redundant. In fact, agents can be implemented purely with CLI tools as well. An example of that approach done right is mini-swe-agent, which exclusively uses bash for all its tool interactions. The relevance here is that even though we’d indeed have to build some MCP tools, we’ll be selective. (described further in low level components section)
Implementation - high level orchestration
The entire plan would be orchestrated via three clearly defined stages. These are deliberately kept straightforward to resemble the actual flow when drafting a template.
1. TemplateMark generation
2. Concerto model generation
3. Logic generation
Descriptions of some low level components (LexNLP, Vector DB for RAG, Docs MCP etc.) mentioned here are available in the next section “Implementation - low level components”
Additionally I’d like to define a couple terms (from langchain docs) before proceeding:
1. Workflows have predetermined code paths and are designed to operate in a certain order.
2. Agents are dynamic and define their own processes and tool usage (usually based on feedback from surroundings).
The underlying design choice I would like to have for this project is that we should prefer to use workflows when a path is clearly defined and only use agents otherwise.
Stage 1 - TemplateMark Generation
The base input in this step would be the raw contract text. The goal would be to extract legal “entities” and replace their occurrences in the raw text with syntactically correct TemplateMark representations.
The following tools (via MCP) will be needed by the agentic part as part of this stage (described further in low level components):
* docs-mcp : tool to search across accord project docs
* replace-by-index: tool to replace strings by indices
* search-and-match: tool to search for occurrences of strings and 
* template-engine: to validate syntax of the generated TemplateMark
The overall execution flow would be along these lines:
The Non-Agentic (purely workflow) Part
1. Extract legal entities deterministically (using LexNLP)
2. Build a prompt, which should include:
   1. Raw contract text
   2. LexNLP entity data
   3. Few-shot RAG examples from templates repo
   4. Instructions to perform the task (what needs to be done, what tools are available)
3. The prompt is then passed to an agent pipeline.
The Agentic Part (“Grammar Generator” Agent)
1. LLM receives the prompt.
2. Establishes whether any tool is needed, makes use of the docs tool if needed.
3. Goes through the list of LexNLP entities and creates a new “replacement map”, containing the index of the string to be replaced, as well as the corresponding TemplateMark variable to replace it with. The LexNLP ones are strictly treated as “suggestions” and are not guaranteed to be added to the final replacement map.
4. If the LLM thinks any additional entities should be present in the map that might have been missed by LexNLP, it searches for them and adds them one-by-one using the search-and-match tool. The purpose of the search-and-match tool is to find the index of the string that the LLM wants to add to the replacement map.
5. Once the replacement map is ready, the LLM uses the replace-by-index tool to replace the whole batch of strings with the generated replacements deterministically.
6. Finally, it uses the template-engine tool to validate the syntax of the generated TemplateMark. 
7. If the validation fails, the control goes back to the LLM decision step, where it can decide what to do next (review the docs, reiterate the replacement map). Otherwise, we move to the next stage.
Note: The motivation behind only allowing the LLM to replace by index is to preserve integrity of the original contract. The LLM might hallucinate and add/remove integral details if we allow it to generate the whole thing.
With this, we are introduced to our first agent - “Grammar Generator”. Essentially, this is a router pattern combined with a feedback loop. The first stage can be summarised as:
  

Stage 2 - Concerto Generation
The goal of this stage would be to generate a valid concerto data model for the entities identified in Stage 1. The agent would have access to these tools:
* docs-mcp: docs reference
* models-mcp: to search for models present in the models repo, that can be extended or built upon.
* template-engine: validation
Execution Flow:
Non-agentic part
1. Based on the TemplateMark, get the data mappings. Here’s a snippet from template playground to describe what I mean.  The JSON data field on the page is what I imply by “data mappings”.
2. Build a prompt, which should include:
   1. Generated TemplateMark.
   2. Few-shot RAG examples from templates repo.
   3. Data mappings (to understand nature of data stored in the template variables)
   4. Specific instructions for concerto model generation.
   3. Pass prompt to LLM.
Agentic part (Model Builder)
   1. LLM decides the next step (model generation/refer to docs/refer to models repo).
   2. If it chooses to proceed with generation, validation is performed using template-engine. Note: Here, validation is performed on both components together- TemplateMark as well as the concerto data model, similar to how it is done in Template Studio. This means that this is not just a concerto syntax validation, it’s essentially a kind of a “grounding” check across contract components as well. This is useful to prevent the LLM from hallucinating variables/clauses that were never there in the template.
   3. In case of validation failure, go back to the LLM decision step.
   4. Iterate until validation is failing. Proceed to the next stage if it passes.
This is the Model Builder agent, second addition to our roster. So, the second stage would be as follows:  
Stage 3 - Logic Generation
The goal of this stage is to generate valid TypeScript logic based on the obligation specified in the contract, such that it also maintains conformity with the data model.
The initial input for this stage would be the TemplateMark as well as the data model.
Current LLMs do fairly well with generation of typescript code. A challenge that arises here is to verify whether the code is actually aligned with the expectations of the contract. This can be done via a human-in-the-loop audit step, which is illustrated in the proposed flow.
In terms of tools, we’d only need the following for this stage.
   * docs-mcp: docs reference
   * template-engine: to validate the logic together with the data model and the template mark.
   * TypeScript compiler (via CLI): to run/validate typescript.
Another thing to note is that in our templates library, for each sample contract, we have both the logic code as well as a test suite for it. Also, the logic for the contracts is written in the now deprecated Ergo, although there is an ongoing migration as part of this PR. This is what that means for us: We can’t use few-shot RAG for our logic generating workflow as we simply do not have the data for it.
That gives us 2 options:
   1. Complete the migration first, then use the examples for RAG here.
   2. Don’t rely on the migration. Make the logic generation independent of few-shot examples.
Fortunately, TypeScript isn’t as domain-specific compared to TemplateMark and Concerto. Sure, there are patterns we need to follow for our typescript logic as well but in my opinion, that can easily be inferred from the docs, meaning that the LLM can also infer it via the docs-mcp tool without having to look at examples.
Therefore, I propose going with the second option. We can always integrate few-shot RAG for logic later on if we really need it.
Here’s the execution flow:
Non-agentic part
   1. As a fixed node in our workflow, provide the TemplateMark, data model and the data mappings as context and give a well-specified prompt to generate an “obligation map”, using structured output from the LLM. 
The obligation map is simply a dictionary of all the obligations extracted from the contract, expressed in natural language. Let’s take this supply agreement contract as an example. This is what I expect the obligation map to look like:
  
   2. Now, the obligation map would be presented to the user (in an easily readable format). They would have the option to approve/add/remove any obligations. Unless approval is granted, the list would be shown to the user with the requested fix applied (over and over until approved). Since it’s all natural language, even a user having minimal technical knowledge would be able to make it work. This is the primary “Approval Gate” in our workflow.
   3. I feel that logic generation here is essentially a candidate for test-driven development (TDD). Therefore, once approved by the user, the map would be used as the basis for the generation of a test suite. This would also be part of our fixed workflow (i.e. no agent involved yet). The data points for these tests would be generated through the following process: (Todo: how to generate data points.)
   4. After test-suite generation, a grounding step would be performed, to verify that each test in the suite has a corresponding obligation in the map. If not grounded, it will go back to the test-suite generation step with the context to fix it. (Todo: How to ground)
   5. Finally, a prompt would be built with these parts as context:
      1. Expected interface as per the generated test suite
      2. Obligation map
      3. Expected Interface for the test suite
      4. Specific instructions to write the logic.
I propose that we don’t provide the test suite as context in the prompt. This is to ensure the LLM doesn’t hardcode values when writing the logic. However, we do need a way to describe to it the interface expected by the suite. I have not been able to work out how exactly that can be done, and I intend to discuss it with the project mentors.
Agentic part (Logic Generator)
      1. LLM chooses next step (refer to docs/generate logic)
      2. If it proceeds with logic generation, typescript compilation needs to be performed to validate syntax.
      3. If compilation is successful, it needs to be run against the test suite. Results are fed back to the LLM to reiterate.
      4. When full test suite passes, validation is performed using the template-engine (to check conformance with the TemplateMark and Concerto model)
      5. If all passes, the stage is considered to be complete.
This is our third agent - Logic Generator. In summary, Stage 3 would look like this:  
The Backtracking Problem
Across all stages, we have assumed the output of the previous stage(s) to always be correct. There could be cases where fixing the current artifact would require modifying something that was generated in a previous step. The challenge is to figure out how exactly this “backtracking” should be orchestrated- as in which steps from which workflows need to be repeated and so on. In theory, we could provide each agent to modify any artifact, even the ones they aren’t responsible for, but then the purpose of “separation of concerns” would be defeated.
As a solution, I propose the addition of another agent, the final addition to our roster - “Remediation Agent”.
In order to understand when it would be invoked, let’s think of when exactly backtracking is needed-
      1. Backtracking is needed when it’s impossible to get the current artifact validated, unless a particular change is made to a previous artifact.
      2. So, how do we figure that out? - I propose we should assume that if any agent, in any stage exceeds its retry limit, a patch might be needed in a previous artifact.
So, the job of the Remediation agent would be to diagnose and try to fix a failure. It would have access to all the generated artifacts (TemplateMark, Data mappings, Concerto model, logic, test suite) as well as the original contract. Tools available to the agent would be:
      * docs-mcp
      * template-engine
Here is how it would work:
      1. Identify which artifact is the root cause (using structured output to produce a single answer). This prompt for this step would also contain the failing agent’s error message as context.
      2. Generate a patch for the artifact in question and run validation.
      3. Update the affected stage’s state and reset its retry limit. Then wipe the isolated state of all downstream stages and rerun them from that point using the updated state, including the patched artifact.
Note: This would be implemented by using a LangGraph checkpoint to persist the state. Before re-running, the persisted state for that stage would be taken and updated with the patch.
Now even this agent is subject to failure. Therefore, we would maintain a remediation_limit variable in its graph state to avoid loops. If even the remediation_limit is exceeded, that would imply complete failure. 
Below is the agentic loop for the remediation agent. As described, it gets invoked when an agent hits a retry limit:
  

________________
Dynamic Entry Points
Till now, the pipeline assumes users would always start with a static contract. However, it is often the case that only the logic is missing, while the TemplateMark and Concerto are already present, as made clear by the LLM Executor GSoC project idea this year.
The solution I have for that is to have dynamic entry points and route the flow to a relevant stage based on the files present in the working folder (described further in the “User Interface” section).
We would have a check for this in the LangGraph START node, which would be responsible for routing.
What if the user provides a broken (incomplete/wrong syntax) contract? 
         * An agent eventually fails (retry limit is hit)
         * Control goes to remediation agent
         * The remediation agent attempts to make a patch in whichever artifact it identifies as the root cause, and routes control to the relevant stage.
Therefore, even broken contracts can be handled gracefully through this approach.
Implementation - low level components/design
Choice of framework for agent/workflow orchestration
I’ll go with LangChain/LangGraph due to the following reasons:
         1. LangGraph is more mature as a framework.
         2. The pipeline I’ve proposed is not purely agentic. It is scaffolded where possible and agentic where required. CrewAI is better for purely agentic autonomous pipelines.
         3. We have a human-in-the-loop step. Also, we need to keep track of the exact graph state for steps such as the remediation one. This is easier to do in LangGraph.
         4. I’ve worked with LangGraph before.
Also, since LangGraph is a Python library, the repo would be a Python codebase.
LexNLP for legal entity extraction
LexNLP is a python library that I found to work quickly and well for extracting legal entities, deterministically. For this contract, it extracted the following entities. (Note how it also provides indices, making the entities easier to find/replace) todo!!!!!!!!
This isn’t strictly necessary but serves as a solid baseline for the LLM to build upon, instead of purely relying on the LLM for entity extraction. However, the last commit was 3 years ago. Whether or not we can use this needs to be discussed with mentors. In case it’s turned down, the fallback strategy is to stick to a pure-LLM approach for entity extraction.
MCP Server for Docs and the Models library
The documentation websites are both docusaurus-based and so, the docs for both accord project and concerto are largely available as .md files.
For the agents to have access to the docs:
         1. I would first create vector embeddings for the content of the markdown files. These embeddings would be stored in a vector store (pgvector).
         2. Then expose a tool over an MCP server, as search_docs(query: str). This would do a vector similarity search over our embeddings and return the “top-k” most relevant chunks. This is essentially a RAG implementation.
For the scope of this project, I would do the embedding part manually (preferably using sentence_transformers), but yes, ideally we should have a way to automatically refresh embeddings in our vector store whenever a PR is merged in the techdocs repo so that it’s always up to date.
Additionally, I would like to do a feasibility test for a pre-built alternative (grounded.tools) to see if we really need a custom solution.
For the concerto models library, I would expose the directory of models over an MCP server similarly.
Few-shot examples using RAG
Here’s how I’ll do this:
         1. Create a dataset of contracts, using the templates repo as reference. Each entry in the dataset would be a contract, having the following fields: 
         * contract_id
         * natural_text (vector)
         * templatemark
         * data_mappings
         * concerto_model
         2. Create embeddings for natural text only and populate a vector store with it.
         3. At the time of retrieval, calculate vector similarity of the input contract’s natural text (the user-provided one) and return the top “k” matches from our vector store.
         4. Append the results along with their metadata to the LLM prompt.
This would provide the agent with a few, most relevant examples. (Few-shot RAG).
Template-engine and TypeScript compiler (via CLI)
We don’t need MCP for these agent tools since they already have a nice enough CLI (template engine CLI). These tools would be made available to the agent via a CLI interface.
To do this, I’ll wrap predefined commands (for both the template engine as well as the typescript compiler) in a subprocess and define each of them as a tool using the @tool decorator in LangGraph.
MCP Server for string operations
In stage 1, the agent calls these deterministic string operations: 
         * replace-by-index 
         * search-and-match. 
These would be implemented as pure python functions and exposed as MCP tools.
Interface with the CLI: API-first, “thin client”
The user-facing CLI will be designed as a decoupled client that consumes a high-level API from the core pipeline. This makes it easy to add alternative user interfaces in the future.
The high-level API would be exposed using a FastAPI websocket server. I’ll prefer to go with this because:
         1. The pipeline is effectively a persistent service.
         2. We’d need to statefully stream data from the pipeline to display progress.
I am yet to find clarity on the CLI library to use, but I’m leaning towards Rich.
LangGraph Specifics
The pipeline has been designed keeping LangGraph’s interface in mind. 
         * The pipeline as a whole would be a “graph”. Across a graph, a common “state” variable is shared. The structure of the state can be defined similarly to a Pydantic schema. This is how a bare minimum state variable could look for our use case.  
         * Each “stage” we’ve defined would be a “subgraph”. The subgraphs themselves would have an isolated state. They’d consume required values from the global state, and append results to the relevant global state fields when done. The isolated state for stage 1 would be modeled as (non-exhaustive, for the purpose of an example):  
         * The scaffolded parts would be implemented as LangGraph “workflows”, using deterministic “nodes” and “edges” to create the execution flow.
         * For our feedback based agents, LangGraph has a create_agent function, which we’ll use to build the agent loop.
         * To implement the human-in-the-loop audit step, I’ll use an interrupt, as defined here.
Persistence across sessions
To do
Choice of LLM (and parameters)
The pipeline would be made agnostic by using liteLLM for all LLM calls. Performance would obviously be better with a heavier LLM but for the majority of prototyping/testing, I will prefer to use an accessible model such as Gemini Flash. In fact, doing so would give us a clearer understanding of the ground reality.
The LLM parameters (temperature, max tokens etc.) would primarily be set through rigorous trial-and-error testing.
Whether the parameters should be static or dynamic is also something that would be decided through observation. An example of this case: if an agent fails, the retry loop must be performed with a lower temperature.
Agent failure strategy
Failure handling strategy is briefly highlighted in the remediation stage.
            * The general idea is that each agent would have an independent retry limit. 
            * If the agent exceeds its retry limit, control goes to the remediation agent, which attempts a patch and sends control back to the relevant stage. This is counted as one remediation loop. 
            * There would also be a limit on the number of remediation loops that can be performed before reporting failure.
User Interface
The user-facing interface for the agentic workflow would be a CLI.
For reference, “working folder” is the term the CLI would use to refer to the folder that would have the artifacts related to the contract. For a complete, from-scratch flow, it would only contain the natural text contract, in markdown. But it could contain additional artifacts as well. Structure of this folder would be expected to be as per the
The high-level behaviour I intend to deliver is as follows:
            1. User invokes the CLI.
            2. CLI prompts the user: “Is <current_directory> your working folder”?
            3. User confirms or declines. In case of decline, the CLI asks the user the location of the intended working folder. CLI opens a terminal window in that folder.
            4. In case of 
Strategy for testing
Deterministic Components
            * This includes the MCP tools, cli wrappers and the graph routing logic.
            * I’ll use pytest unit tests to ensure all deterministic functionality works perfectly before an LLM ever touches it.
Orchestration and State
            * This includes the state persistence, HITL step, backtracking logic. Mock LLM outputs would be the key here.
            * Also, API testing for the fastAPI websocket server would be required. I’ll use FastAPI’s TestClient for this.
Evaluation of Agentic Workflow
            * This would be the high-level, behavioural testing of our agentic workflow as a system.
            * The approach I’m considering is similar to a common ML practice of splitting a source dataset into training and testing subsets:
            * We currently have around 55 contracts in our templates repository, which form the basis of our RAG few-shot dataset. 
            * I plan to divide these into training and testing sets. 
            * Only the training set will be used for RAG, while the testing set will be reserved for evaluation. 
            * Assessing correctness will require manual verification, but since we only have a relatively small number of contracts, this should be manageable.
User Interface Testing
This involves testing the CLI. The plan is to build the CLI such that it is a thin client, and therefore, the only tests we’d need here would be to verify if it correctly parses responses from the server, and sends requests correctly.
Deliverables
I plan to implement the following deliverables:
            1. Timeline
To do
Benefits to community/Use cases
To do
