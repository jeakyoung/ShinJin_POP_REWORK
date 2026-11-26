package com.shinjin.pop.basket;

import com.shinjin.pop.admin.TerminalSettingsDemoController;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.context.annotation.Profile;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;
import synthetic.basket.BasketDomain.*;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import static com.shinjin.pop.basket.BasketStockCatalog.*;

@RestController
@Profile("demo")
@RequestMapping("/api/pop/work-baskets/stock-picker/{date}/{sequence}")
final class BasketStockPickerController {
    record Scope(View view,Site site,Work focus,List<Work> checked,List<Place> issue,List<Place> auxiliary,String status) {
        List<Place> places(String role) {
            return switch(role==null?"":role){case "issue"->issue;case "auxiliary"->auxiliary;default->throw error(HttpStatus.BAD_REQUEST);};
        }
        String grades() {
            String grade=focus.plan().columns().quality();
            return "014".equals(grade)||"015".equals(grade)?"014,015,019":grade;
        }
        String id(){return view.actor().scope().factory()+"/"+site.terminal();}
    }
    record Screen(List<Place> issue,List<Place> auxiliary,String initial,String quality,BigDecimal thickness,BigDecimal width) {}
    record Choice(String role,String code) {}
    record Lookup(String role,String warehouse,BigDecimal thickness,BigDecimal width) {}
    record PlaceScan(String warehouse,String raw) {}
    record Remnants(boolean eligible,List<Candidate> rows) {}
    private static final Set<String> REMNANT_GRADES=Set.of("007","015","019","024","025","026","029","034","035","038","039");
    private final BasketDemoController basket;
    private final BasketStockCatalog catalog;
    private final TerminalSettingsDemoController settings;
    private final Map<String,String> fixed=new ConcurrentHashMap<>();
    BasketStockPickerController(BasketDemoController basket,BasketStockCatalog catalog,TerminalSettingsDemoController settings){
        this.basket=basket;this.catalog=catalog;this.settings=settings;
    }
    private static ResponseStatusException error(HttpStatus status){return new ResponseStatusException(status);}
    private Scope scope(LocalDate date,int sequence,List<String> checked,HttpServletRequest request) {
        View view=basket.pickerView(request);
        var focus=view.work().stream().filter(work->work.plan().key().equals(new PlanKey(date,sequence))).findFirst().orElseThrow(()->error(HttpStatus.NOT_FOUND));
        if(focus.phase()==Phase.PAUSED||focus.phase()==Phase.COMPLETED)throw error(HttpStatus.CONFLICT);
        var keys=new HashSet<>(checked);
        var selected=view.work().stream().filter(work->keys.contains(work.plan().key().date()+"/"+work.plan().key().sequence())).toList();
        if(keys.isEmpty()||selected.size()!=keys.size()||selected.stream().anyMatch(w->w.phase()==Phase.COMPLETED))throw error(HttpStatus.BAD_REQUEST);
        Site site=catalog.site(view.actor().terminal());
        if(site==null||focus.plan().columns()==null)throw error(HttpStatus.NOT_FOUND);
        String status=site.plans().stream().filter(p->p.key().equals(focus.plan().key())).map(PlanStatus::status).findFirst().orElseThrow(()->error(HttpStatus.NOT_FOUND));
        var roles=settings.pinnedWarehouseRoles(request);
        var issue=site.issue().stream().filter(p->roles.map(r->r.getOrDefault("issue",List.of()).contains(p.code())).orElse(true)).toList();
        var aux=site.auxiliary().stream().filter(p->roles.map(r->r.getOrDefault("auxiliary",List.of()).contains(p.code())).orElse(true)).toList();
        if(issue.isEmpty())throw error(HttpStatus.CONFLICT);
        return new Scope(view,site,focus,selected,issue,aux,status);
    }
    private static boolean contains(List<Place> places,String code){return places.stream().anyMatch(p->p.code().equals(code));}
    @GetMapping
    Screen view(@PathVariable LocalDate date,@PathVariable int sequence,@RequestParam List<String> checked,HttpServletRequest request){
        var s=scope(date,sequence,checked,request);
        String code=fixed.getOrDefault(s.id(),s.issue().get(0).code());
        if(!contains(s.issue(),code)&&!contains(s.auxiliary(),code))code="";
        var columns=s.checked().stream().map(w->w.plan().columns()).filter(Objects::nonNull).toList();
        return new Screen(s.issue(),s.auxiliary(),code,s.focus().plan().columns().qualityName(),
                columns.stream().map(Columns::thickness).filter(Objects::nonNull).max(BigDecimal::compareTo).orElse(BigDecimal.ZERO),
                columns.stream().map(Columns::width).filter(Objects::nonNull).max(BigDecimal::compareTo).orElse(BigDecimal.ZERO));
    }
    @PutMapping("/fixed")
    Choice fix(@PathVariable LocalDate date,@PathVariable int sequence,@RequestParam List<String> checked,@RequestBody Choice in,HttpServletRequest request){
        var s=scope(date,sequence,checked,request);if(!contains(s.places(in.role()),in.code()))throw error(HttpStatus.FORBIDDEN);
        fixed.put(s.id(),in.code());return in;
    }
    @PostMapping("/stock")
    List<Candidate> stock(@PathVariable LocalDate date,@PathVariable int sequence,@RequestParam List<String> checked,@RequestBody Lookup in,HttpServletRequest request){
        var s=scope(date,sequence,checked,request);
        if(in.warehouse()==null||in.thickness()==null||in.width()==null)throw error(HttpStatus.BAD_REQUEST);
        boolean restoredAux="issue".equals(in.role()) && in.warehouse().equals(fixed.get(s.id())) && contains(s.auxiliary(),in.warehouse());
        if(!restoredAux && !(in.warehouse().isEmpty()&&"issue".equals(in.role())) && !contains(s.places(in.role()),in.warehouse()))throw error(HttpStatus.FORBIDDEN);
        var rows=catalog.query(s.site(),s.view(),"SELECT",in.warehouse(),s.grades(),s.status(),in.thickness(),in.width(),BigDecimal.ZERO)
            .stream().filter(r->contains(s.issue(),r.warehouse())||contains(s.auxiliary(),r.warehouse())).toList();
        basket.rememberStock(request,s.view().actor(),s.focus().plan().key(),rows);return rows;
    }
    @PostMapping("/location")
    List<Place> location(@PathVariable LocalDate date,@PathVariable int sequence,@RequestParam List<String> checked,@RequestBody PlaceScan in,HttpServletRequest request){
        var s=scope(date,sequence,checked,request);
        if(in.warehouse()==null||in.raw()==null)throw error(HttpStatus.BAD_REQUEST);
        if(!in.warehouse().isEmpty()&&!contains(s.issue(),in.warehouse())&&!(in.warehouse().equals(fixed.get(s.id()))&&contains(s.auxiliary(),in.warehouse())))
            throw error(HttpStatus.FORBIDDEN);
        return s.site().locations().stream().filter(l->l.warehouse().equals(in.warehouse())&&l.raw().equals(in.raw())).map(Location::location).limit(1).toList();
    }
    @PostMapping("/remnants")
    Remnants remnants(@PathVariable LocalDate date,@PathVariable int sequence,@RequestParam List<String> checked,HttpServletRequest request){
        var s=scope(date,sequence,checked,request);
        if(Arrays.stream(s.grades().split(",")).noneMatch(REMNANT_GRADES::contains))return new Remnants(false,List.of());
        boolean first="001".equals(s.view().actor().workCode()),plantOne="000001".equals(s.site().plant());
        var size=BigDecimal.valueOf(first?7:3);
        var rows=catalog.query(s.site(),s.view(),"SELECT2",first?(plantOne?"001":"201"):(plantOne?"010":"210"),s.grades(),first?"W":"Z",size,size,size);
        basket.rememberStock(request,s.view().actor(),s.focus().plan().key(),rows);return new Remnants(true,rows);
    }
}
