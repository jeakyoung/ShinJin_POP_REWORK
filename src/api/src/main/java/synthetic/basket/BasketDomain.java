package synthetic.basket;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.Set;

public interface BasketDomain {
    enum Mode { BASKET, ALL_LIST, CHECKED_LIST }
    enum Action { SAVE_BASKET, START_BASKET, PAUSE_BASKET, RESUME_BASKET, FINISH_BASKET, DELETE_ROW, DELETE_UNFINISHED, CLEAR_BASKET_ISSUES, CLEAR_BASKET_RETURNS, SET_RETURN_QUANTITY, ADD_MANUAL_ISSUE, REMOVE_ISSUE_ROWS, REMOVE_RETURN_ROWS }
    enum Phase { READY, BASKETED, STARTED, PAUSED, COMPLETED }

    record Scope(String factory, String site, String center) {}
    record Actor(Scope scope,String terminal,String worker,String workCode) {
        public Actor(Scope scope,String terminal,String worker){this(scope,terminal,worker,null);}
    }
    record PlanKey(LocalDate date, int sequence) {}
    record Columns(String mergeKey,String quality,String qualityName,BigDecimal thickness,BigDecimal width,BigDecimal length,
                   String customer,LocalDate orderDate,LocalDate dueDate,String remark) {}
    record Plan(PlanKey key, String order, int orderLine, String item,Columns columns) {
        public Plan(PlanKey key,String order,int orderLine,String item){this(key,order,orderLine,item,null);}
    }
    record Lot(String item, String lot, String warehouse, String position) {}
    record Issue(Lot lot, BigDecimal quantity) {}
    record ReturnLine(Lot lot, BigDecimal quantity, BigDecimal length) {}
    record Work(Plan plan, Phase phase, String groupId, BigDecimal produced) {
        public Work(Plan plan,Phase phase,String groupId){this(plan,phase,groupId,null);}
    }
    record ProductionAmount(PlanKey key,BigDecimal quantity) {}
    record DisplayLot(Lot lot, String warehouseName, String locationName, String qualityName,
                      BigDecimal thickness, BigDecimal width, BigDecimal length) {}
    record ReturnEdit(int sequence, BigDecimal quantity) {}
    record ProductionReturn(int sequence, ReturnLine line, DisplayLot material, LocalDate outputDate,
                            String createdBy, Instant createdAt, String updatedBy, Instant updatedAt) {}
    record ProductionIssue(int sequence, Issue line, String createdBy, Instant createdAt) {}
    record Group(String id, String terminal, List<Issue> issues, List<ReturnLine> returns, Instant startedAt,
                 LocalDate savedDate, List<ProductionReturn> productionReturns, List<ProductionIssue> productionIssues,
                 List<Integer> issueSequences, List<Integer> returnSequences) {
        public Group(String id,String terminal,List<Issue> issues,List<ReturnLine> returns,Instant startedAt,
                     LocalDate savedDate,List<ProductionReturn> productionReturns,List<ProductionIssue> productionIssues) {
            this(id,terminal,issues,returns,startedAt,savedDate,productionReturns,productionIssues,
                    java.util.stream.IntStream.rangeClosed(1,issues.size()).boxed().toList(),
                    java.util.stream.IntStream.rangeClosed(1,returns.size()).boxed().toList());
        }
        public Group(String id,String terminal,List<Issue> issues,List<ReturnLine> returns,Instant startedAt,
                     LocalDate savedDate,List<ProductionReturn> productionReturns) {
            this(id,terminal,issues,returns,startedAt,savedDate,productionReturns,List.of());
        }
        public Group(String id, String terminal, List<Issue> issues, List<ReturnLine> returns, Instant startedAt) {
            this(id, terminal, issues, returns, startedAt, null, List.of());
        }
        public Group {
            issues = List.copyOf(issues);
            returns = List.copyOf(returns);
            productionReturns = List.copyOf(productionReturns);
            productionIssues = List.copyOf(productionIssues);
            issueSequences = List.copyOf(issueSequences);
            returnSequences = List.copyOf(returnSequences);
        }
    }
    record Seed(Mode mode, Map<String, Boolean> terminals, List<Work> work, List<Group> groups,
                Map<Lot, BigDecimal> stock, Set<Lot> returnCandidates) {
        public Seed {
            terminals = Map.copyOf(terminals);
            work = List.copyOf(work);
            groups = List.copyOf(groups);
            stock = Map.copyOf(stock);
            returnCandidates = Set.copyOf(returnCandidates);
        }
    }
    record Material(Lot lot, BigDecimal available,DisplayLot display) {
        public Material(Lot lot,BigDecimal available){this(lot,available,null);}
    }
    record View(Actor actor, Mode mode, boolean canWrite, long revision, List<Work> work,
                List<Group> groups, List<Material> materials, List<Lot> returnCandidates) {
        public View {
            work = List.copyOf(work);
            groups = List.copyOf(groups);
            materials = List.copyOf(materials);
            returnCandidates = List.copyOf(returnCandidates);
        }
    }
    record MaterialRemoval(List<Integer> rows,List<Integer> checked) {
        public MaterialRemoval {
            rows=rows==null?List.of():List.copyOf(rows);
            checked=checked==null?List.of():List.copyOf(checked);
        }
    }
    record Command(Action action, String requestId, Long expectedRevision, List<PlanKey> visible,
                   List<PlanKey> selected, List<Issue> issues, List<ReturnLine> returns, String groupId, ReturnEdit returnEdit,
                   List<ProductionAmount> amounts, Integer manualSequence,MaterialRemoval removal) {
        public Command(Action action,String requestId,Long expectedRevision,List<PlanKey> visible,List<PlanKey> selected,
                       List<Issue> issues,List<ReturnLine> returns,String groupId,ReturnEdit edit,List<ProductionAmount> amounts,Integer manualSequence) {
            this(action,requestId,expectedRevision,visible,selected,issues,returns,groupId,edit,amounts,manualSequence,null);
        }
        public Command(Action action,String requestId,Long expectedRevision,List<PlanKey> visible,List<PlanKey> selected,
                       List<Issue> issues,List<ReturnLine> returns,String groupId,ReturnEdit edit,List<ProductionAmount> amounts) {
            this(action,requestId,expectedRevision,visible,selected,issues,returns,groupId,edit,amounts,null);
        }
        public Command(Action action,String requestId,Long expectedRevision,List<PlanKey> visible,List<PlanKey> selected,List<Issue> issues,List<ReturnLine> returns,String groupId,ReturnEdit edit) {
            this(action,requestId,expectedRevision,visible,selected,issues,returns,groupId,edit,null);
        }
        public Command(Action action, String requestId, Long expectedRevision, List<PlanKey> visible,
                       List<PlanKey> selected, List<Issue> issues, List<ReturnLine> returns) {
            this(action, requestId, expectedRevision, visible, selected, issues, returns, null, null);
        }
        public Command {
            amounts = amounts == null ? List.of() : List.copyOf(amounts);
            visible = visible == null ? List.of() : List.copyOf(visible);
            selected = selected == null ? List.of() : List.copyOf(selected);
            issues = issues == null ? List.of() : List.copyOf(issues);
            returns = returns == null ? List.of() : List.copyOf(returns);
        }
    }
    record Result(long revision, List<PlanKey> affected, String groupId) {
        public Result { affected = List.copyOf(affected); }
    }
    record Reply<T>(int status, String error, T value) {}

    Reply<View> view(Actor actor);
    default Reply<Result> execute(Actor actor, Command command) { return execute(actor,command,Set.of()); }
    Reply<Result> execute(Actor actor, Command command, Set<Lot> queried);
}
